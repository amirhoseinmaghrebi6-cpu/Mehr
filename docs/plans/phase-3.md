# Phase 3 plan: real homes, hardware catalog, devices and commands

Status: approved 2026-09-29. Implementation in progress, starting with 3A.

**Goal:** a signed-in user's homes, rooms and devices come from the M2smart API and PostgreSQL instead of browser storage. Devices are defined by M2smart's own hardware catalog. Commands go through the API and count as done only when the ESP32 reports the real state. Real hubs and pairing (Phase 4) and firmware (Phases 6–7) are not part of this phase; a dev simulator stands in for them.

## Hardware model (confirmed with the product owner)

- **Every device is M2smart's own hardware.** Each device is an ESP32 board designed by M2smart, already built or planned.
- **Pins are fixed per board.** The PCB design decides which GPIO does what: relay output, TRIAC dimmer, digital input, or a sensor on a bus such as I2C, UART or ADC.
  - Users never see or change pin assignments.
  - The pin assignments live in a hardware catalog maintained only by M2smart.
- **No ESP32 is ever shared between homes.** One device on a board uses one or more of its pins.
- **Wall switches work without the internet.** A wall switch is an input pin; the ESP32 toggles the relay itself and then reports, so it works with no hub and no internet.
- **Dimmers are TRIAC-based**, with brightness 0–100.
- **Power loss:** after power loss or a reset, relays return to their last state. The ESP32 keeps that state in its own flash (NVS) and reports it when it starts.
- **When a command is done:** a command is done only when the ESP32 reports the real state. The hub receiving it is not enough.
- **Home roles are only owner, admin and member.** The guest and viewer roles are removed.
- **Isolation:** thousands of users share the system. Every read and write is limited to homes the user belongs to, enforced in three independent layers:
  1. The API checks access in code.
  2. RLS in PostgreSQL.
  3. Composite foreign keys, so no row can point into another home.

## Findings from the code that shape the plan

- **Homes live only in the browser today.** `services/workspace-store.ts` keeps homes, rooms and devices in localStorage, and `services/home-gateway.ts` ignores commands.
- **Signing up creates no home.** `handle_new_auth_user()` creates a profile, a personal organization and owner membership, but no property.
- **The Phase 1 tables already exist,** protected by RLS and composite foreign keys: `properties`, `property_members`, `hubs`, `devices`, `device_capabilities`, `device_states`, `device_commands`, `command_attempts`, `realtime_events`. They are extended, not replaced.
- **What the database is missing:**
  - `devices.kind` allows only 8 generic kinds, and devices have no link to a board or its pins.
  - There is no `rooms` table.
  - `property_members.role` still allows `guest` and `viewer`.
- **Property rights come from `property_members` only.** A new home must add its creator as owner in the same step that creates it.
- **The demo account is not a database user.** It keeps its mock data (standing requirement).

## Device types and capabilities

A device type is a set of capabilities. Capabilities use the existing `device_capabilities` value types: `boolean`, `integer`, `number`, `enum`. `R` means reported only; everything else can be written by users.

| Device type | Capabilities | Board notes |
|-------------|--------------|-------------|
| Switch channel (1-, 2- or 3-channel boards) | `power` boolean | 1 relay out + 1 wall input per channel |
| Dimmer / smart lamp | `brightness` integer 0–100 (0 = off) | TRIAC gate out + zero-cross in + wall input |
| Smart socket | `power` boolean; `power_w`, `energy_kwh` R | relay + energy chip |
| Evaporative cooler | `pump` boolean; `speed` enum off/low/high | 3 relays: pump, low, high (low and high never on together) |
| Fan | `speed` enum off/low/high | 2 relays (assumed like the cooler motor) |
| Curtain / shutter | `curtain` enum open/closed (target; the ESP32 reports it when the run ends) | 2 relays (never on together) |
| Garage door | `door` enum open/closed (target); reported by the door sensor | pulse relay + reed/limit input |
| Alarm | `mode` enum disarmed/armed_home/armed_away; `triggered` boolean R | siren relay + zone inputs |
| Motion / presence sensor | `motion` or `presence` boolean R | PIR input / mmWave (UART) |
| Door / window sensor | `contact` enum open/closed R | reed input |
| Water leak, smoke, CO | `leak`, `smoke` boolean R; `co_ppm` number R | inputs / sensor modules |
| Air quality, humidity, light | `co2_ppm`, `voc_index`, `humidity`, `temperature`, `illuminance_lux` R | I2C/UART/ADC sensors |
| Energy meter | `power_w`, `energy_kwh` R | energy chip |
| Thermostat, split AC, smart lock, doorbell, TV, speaker, camera, air purifier, 2-channel kitchen switch | added as catalog entries when each board's design is final | video and audio (camera, doorbell video, TV, speaker) need a media subsystem and are a separate phase |

- **Garage door commands** are absolute, like every command: the target is `door = open` or `door = closed`. The ESP32 pulses the relay only if the door is not already in that state, and the command is done when the door sensor reports the target.
- **Safety interlocks** are stored in the catalog as data, so the firmware and hub can read and enforce them locally (Phase 4+):
  - cooler low and high are never on together;
  - curtain open and close are never on together.
- **Curtains** are open/closed only: no stop and no percentage position (confirmed).

---

## Order of steps

```
3A contracts, catalog types, permissions ─► 3B database ─► 3C API: homes and rooms ─► 3D API: devices, commands, dev simulator ─► 3E frontend switch ─► 3F exit
```

Each step is its own commit, verified on its own, as in Phase 2.

## Phase 3A: contracts and permissions

- **Files:**
  - `packages/contracts/src/homes.ts`: property, room, controller, device, capability, state and command schemas (zod) and types.
  - `packages/contracts/src/catalog.ts`: device types, capability definitions and interlock rules.
  - `packages/contracts/src/permissions.ts`: role → allowed actions, as plain data the hub can reuse later.
- **Permission table:**

  | Action | owner | admin | member |
  |--------|:-----:|:-----:|:------:|
  | View home, rooms, devices, state | ✓ | ✓ | ✓ |
  | Control devices (commands) | ✓ | ✓ | ✓ |
  | Edit home and rooms; rename or move devices | ✓ | ✓ | – |
  | Delete home | ✓ | – | – |

- **Checks:** contracts build; unit tests for the permission table and the capability schemas.

## Phase 3B: database (new, additive migrations; existing files unchanged)

- **Hardware catalog:** only M2smart writes it, through migrations or an internal tool. Users can read it and never write it.
  - `hardware_models`: board model and revision, e.g. `switch-2ch-rev-a`.
  - `hardware_model_pins`: `gpio`, `direction` (in/out), `function` (relay, triac_gate, zero_cross, digital_in, i2c, uart, adc, pulse).
    - Output pins are checked against a list of safe ESP32 GPIOs. Flash pins 6–11, input-only pins 34–39 and boot-strapping pins are rejected for relay or TRIAC outputs.
  - `hardware_model_channels`: the devices a board exposes. Each has its device type, its pins and its capability definitions.
  - `interlock_groups`: channels or relays that must never be on together.
- **Controllers (the ESP32 boards in a home):**
  - `controllers`: `id`, `property_id`, `hub_id`, `model_id`, `hardware_uid` (unique across the whole system), `name`, `firmware_version`, `online`, `last_seen_at`.
  - A composite foreign key ties `(hub_id, property_id)` to the hubs table, so a controller always belongs to its hub's home.
- **Devices:**
  - Add `controller_id` and `channel_key`, with `unique (controller_id, channel_key)`.
  - A composite foreign key to `controllers (id, property_id)` keeps a device in its board's home.
  - Add `device_type` from the catalog. The old `kind` check stays for existing rows, and a new check covers the catalog types.
- **Rooms:**
  - A new `rooms` table: `id`, `property_id`, `name`, `photo` (preset key), `sort_order`, with a unique name per home.
  - `devices.room_id`: a composite foreign key to `rooms (id, property_id)`; it is set to null when the room is deleted.
  - `devices.room_name` is backfilled into rooms and kept for now.
- **Homes:**
  - `properties` gains `address` and `cover_photo` (preset key).
  - `create_property(...)`: a security-definer function that creates the home and the caller's owner membership in one transaction.
- **Roles:** the `property_members.role` check becomes `owner | admin | member`. The migration stops with an error if any `guest` or `viewer` row exists, so no row is silently changed.
- **RLS:**
  - Members can read the catalog, controllers, devices, rooms and state of their own homes.
  - Owners and admins can write rooms, device `name` and device `room_id` (column grants).
  - Controllers, capabilities, state and command progress can be written only by the backend (`service_role`).
- **Scale:** every table and query is keyed and indexed by `property_id`, so a request never scans other homes' rows.
- **SQL tests** (`backend/test/sql/`), with two homes and two users:
  - Neither user can read or write the other home's rows, in any table.
  - A device cannot move into another home's room or controller.
  - Unsafe pins and duplicate pins are rejected.
  - The rights of each of the three roles.
  - `create_property` makes the caller the owner.
- **Checks:** `pnpm db:migrate` on an empty and on an existing database; `pnpm db:test`.

## Phase 3C: API for homes and rooms

- **Endpoints:**
  - `GET/POST /v1/properties`, `PATCH/DELETE /v1/properties/:id`
  - `GET/POST /v1/properties/:id/rooms`, `PATCH/DELETE …/rooms/:roomId`
- **Rules:**
  - Permissions are checked in code first, then RLS runs underneath.
  - A home the user cannot see returns `404`, never revealing that it exists.
  - Other errors are `403`, `409` and `400`.
- **Tests:** vitest integration tests with two tenants, the role table, and input validation.

## Phase 3D: API for devices and commands, and the dev simulator

- **Endpoints:**
  - `GET /v1/properties/:id/devices`: devices with room, type, capabilities, last reported state and online status.
  - `PATCH …/devices/:deviceId`: rename a device, or move it to a room.
  - `POST …/commands` with `{ deviceId, capability, targetValue, idempotencyKey }`:
    - The value is checked against the capability (the existing trigger).
    - Sending the same idempotency key again returns the original command.
  - `GET …/commands/:commandId`: the command's status.
- **Dev simulator** (development only, off unless `M2SMART_DEV_HUB_SIMULATOR=true`):
  - It acts like hub and ESP32:
    - it moves pending commands to `sent`;
    - it enforces the interlocks;
    - it writes the reported state and marks the command `applied`.
  - It also simulates wall-switch presses and sensor changes, which arrive as reported state with no command.
- **Adding a simulated board:** `pnpm dev:board <property-id> <model>` adds one to a home. Real boards only arrive through QR pairing in Phase 4. Until then, the web app's "add device" says a hub is needed.
- **Command timeouts:** commands past `expires_at` become `timed_out`.
- **Tests:**
  - idempotency;
  - invalid values are rejected;
  - interlocks are respected;
  - pending → applied only after a report;
  - no access across homes.

## Phase 3E: frontend switch

- **Real users see only what the API returns.**
  - The HTTP gateway calls `/api/v1/*`.
  - The mock gateway and the localStorage workspace are used only for demo sessions.
- **Controls follow the device type:**
  - on/off switch;
  - 0–100 dimmer slider;
  - off/low/high selector;
  - curtain open/closed;
  - garage open/close;
  - alarm mode;
  - read-only sensor values.
- **Command feedback:**
  - A control shows "pending" at once, then follows the command status by polling (every ~1 s, up to 30 s).
  - `applied` keeps the new value. `rejected`, `failed` or `timed_out` goes back to the reported value, with a message in EN/FA.
- **First home:** a user with no home sees "create your first home".
- **Photos:** home and room photos are chosen from the built-in images (no uploads).
- **Sections with no real data yet** (scenes, automations, energy history, cameras) show a "coming soon" state for real users. The demo keeps all sections.
- **Checks:**
  - e2e flow: register → create home → add room → simulated board → switch on → applied → reload → the state is still there.
  - A second user sees none of it.
  - The demo is unchanged.
  - typecheck, lint, build.

## Phase 3F: exit

- Update `README.md`, `docs/product-architecture.md` and `docs/architecture/trust-boundaries.md`. Add a new `docs/hardware-catalog.md` explaining how to add a board model.
- On a clean copy: install → migrate → db:test → seed → API tests → web e2e (the Phase 2E and 3E flows).

**Not in Phase 3:**
- Real hub, MQTT and QR pairing (Phase 4).
- ESP32 firmware, NVS state restore and on-device interlocks (Phases 6–7).
- Local sirens and hub alarms for smoke, CO, leak and the alarm system (hub phase).
- SMS alerts (with the Iranian SMS provider).
- In-app realtime push (the UI polls for now).
- Scenes and automations.
- Video and audio devices.
- Photo uploads.
- Inviting other members.
- nginx and rate limiting (Phase 9).

## Decisions recorded

- **P3-D1:** sections with no real data show "coming soon" for real users; the demo is unchanged. Approved.
- **P3-D2:** a dev-only simulator stands in for the hub and the ESP32. Approved.
- **P3-D3:** photos come from the built-in images only. Approved.
- **P3-D4:** prototype homes in browser storage are not migrated. Approved.
- **Roles:** owner, admin and member only. Approved.
- **Critical alerts:** SMS and in-app, with no Google FCM or Apple push dependency; a local alarm on the hub. Approved (implemented in later phases).
- **Factory identity:** each board gets a unique ID and key at production, and is added to a home by QR (Phase 4). Approved.
- **Curtains:** open/closed only. Approved.

**Status:** approved 2026-09-29.
