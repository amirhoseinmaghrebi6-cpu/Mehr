# Phase 4 plan: boards connect straight to the cloud (no hub)

Status: approved 2026-10-04; implemented (4A–4F, closed 2026-10-04).

**Goal:** a real ESP32 board can join a home, receive commands and report its state through our own servers in Iran, with no hub in the home. Scheduled scenarios run on the server. The firmware itself comes in Phases 6–7; this phase builds the server side and the contract the firmware will follow, tested with a simulated board that speaks the real protocol.

## Decisions (product owner, 2026-10-04)

These replace earlier decisions; the older documents point here.

1. **No hub.** A hub per home (Raspberry Pi, or even an ESP32-S3) adds cost. Every board connects directly to the cloud MQTT broker.
2. **No control from the app without internet.** With the home's internet down:
   - wall switches still work, because the board toggles its own relay;
   - relays keep their last state after a power loss;
   - nothing else works until the internet is back.
3. **Scenarios run on the server**, not on a hub and not on the boards.
   - A board has no clock after a power loss until it is online again, so schedules stored on boards would fail exactly when they matter.
   - This reverses decision 2 of Phase 3.5 ("no cloud scheduler").
4. **Late runs: a validity window per scenario.** If the power or internet was out at the scheduled time and comes back while the scenario is still valid, it runs then; after the window it is recorded as missed.
   - The user picks the window per scenario: never late, 10 minutes (default), 1 hour or 3 hours.
   - This replaces decision 3 of Phase 3.5 (2 minutes for periodic, 10 minutes for one-time).
5. **Keep only the current state, never history.** With thousands of users and hundreds of thousands of devices, stale data must not pile up anywhere.
   - **Scenarios:** no run history. Each scenario keeps only the result of its latest occurrence, overwritten every time; this is needed so an occurrence never runs twice and the app can show "ran" or "missed". A one-time scenario is deleted automatically once it has run or its validity window has ended.
   - **Commands:** finished commands are deleted after 24 hours.
   - **States:** only the last reported value per capability, overwritten (as today).
   - **Factory reset:** nothing about the board stays on the server: the board, its devices, states, commands and scenario actions are deleted. No audit entry and no notification to the old home. This replaces the audit entry and notification of Phase 3.5, section A.
   - **Temporary data:** pairing codes, SMS codes and expired sessions are cleaned up regularly.
   - **Energy:** the one exception. For metered devices, one total per device per day is kept, for at most one year; nothing finer.
   - **What stays and does not grow:** the registry of manufactured boards (one fixed row per board).
6. **Room for a hub later.** The protocol stays small and hardware-neutral, so a hub could be added without changing the boards' messages, if local control from the app is wanted one day.

Still valid from before:
- a command is final only when the ESP32 reports the real state;
- pin maps are fixed and backend-only;
- the setup button times: 10–15 s pairing mode, 15–20 s nothing, more than 20 s factory reset;
- owning a board means holding it;
- everything runs on Iran's national internet with no foreign runtime dependency.

## How it works

### Connection

- **Broker:** our Mosquitto. Each board has its own username, secret and role, and the role names exactly that board's topics. Access rules are managed by the API through Mosquitto's built-in dynamic security, which also holds each board's broker secret; the database stores none.
- **Encryption:** TLS in production, with our own certificate authority built into the firmware (no foreign certificate service).
- **Topics** (small JSON messages):

| Topic | Direction | Meaning |
|-------|-----------|---------|
| `m2/v1/boards/{boardId}/cmd` | server → board | one command: id, channel, capability, target value, deadline |
| `m2/v1/boards/{boardId}/ack` | board → server | the board has the command and started (e.g. the door motor runs) |
| `m2/v1/boards/{boardId}/state` | board → server | a reported value: after a command, a wall-switch press or a sensor change |
| `m2/v1/boards/{boardId}/status` | board → server | `online`, or `offline` sent by the broker when the connection drops |

- **Coming back online:** connecting is the signal; no extra message is needed. On connect the board reports the full state of all its channels, and the server sends it any commands that are still valid.
- **The API** connects to the broker as an internal service: it publishes pending commands and stores reports. Only this path marks a command sent or applied.

### Pairing (replaces the "found by the hub on the LAN" condition)

A board joins a home only when all three are true:

1. **Someone holds it:** the setup button was held 10–15 s, so the board is in pairing mode for 5 minutes. Only someone next to the board can join its temporary Wi-Fi and see its pairing QR code.
2. **An owner or admin confirms it:** they upload that QR code in the app, in the home they choose.
3. **The board is genuine:** it proves itself to the server with the factory secret written at production; the server keeps a registry of manufactured boards (hardware id, model, secret).

Nothing is printed on the product or its box: the QR code is made by the board itself, so it cannot wear off or get lost.

Steps:
1. Entering pairing mode, the board makes a fresh random pairing secret and opens its own temporary Wi-Fi with a small setup page.
2. The user joins that Wi-Fi with a phone and enters the home's Wi-Fi name and password. The page shows the pairing QR code, and the same code as text in case the image fails; the user saves it.
3. The board joins the home's Wi-Fi and tells the server, with its factory proof, that it is waiting to be paired (the server stores only a hash of the pairing secret).
4. An owner or admin opens "Add a board" in the app, picks the home and uploads the saved QR code (or pastes the text).
5. The server adds the board and all its channels (1 to 20 inputs and outputs) to that home and gives the board a fresh broker secret. Any earlier secret stops working.
6. The app shows all the board's channels on one screen, to name each and put it in a room.

Rules for the pairing code:
- **Fresh every time:** a new code each time the board enters pairing mode, which includes after a factory reset; the previous code stops working.
- **One use:** once a board is paired, its code is useless.
- **24 hours:** an unused code expires and is deleted from the server. Holding the button again gives a new one; no reset is needed.

The firmware builds on Espressif's official ESP-IDF components (Wi-Fi, HTTP server, TLS, MQTT, storage). The setup page, the pairing and reset logic and the protocol are our own code. No third-party Wi-Fi manager library.

### Factory reset

- **On the board:** it erases its broker secret and Wi-Fi settings, then is like new.
  - Before erasing, it tells the server if it is online (best effort).
- **On the server:** the board, its devices, their states and commands, and the scenario actions that used them are deleted. Nothing is kept: no audit entry, no notification.
- **If the server never hears of it:** the next pairing with any home removes the board from the old home, and the old secret is useless once erased.

### Scenarios on the server

- A server job replaces the dev simulator's runner, for all homes.
- At the scheduled time each action becomes a command, as today.
  - Online boards carry it out at once.
  - For an offline board, the command waits until the end of the scenario's validity window and is sent the moment the board reconnects.
  - After the window it expires, and the run shows as missed for that device.
- Only the latest occurrence's result is stored per scenario; a one-time scenario is deleted after it ran or its window ended.
- Commands sent by hand keep their short deadline: a tap on a device that is offline fails quickly, as today.

### Data model

- Additive migrations only.
- The existing `hubs` table stays: each home keeps one internal row that stands for its cloud connection, so no existing table or foreign key changes. A physical hub, if ever added, would be another row.
- New:
  - the board registry (factory secrets stored hashed);
  - pending pairings (hashed code, deleted when used or after 24 hours);
  - the board's broker identity and online status;
  - the scenario's validity window;
  - daily energy totals per metered device (kept one year).
- A cleanup job on the server deletes finished commands after 24 hours, old events, used or expired pairings, finished one-time scenarios, older scenario results and energy totals older than a year.

## Steps

Each step is one commit, tested on its own, with the two-home isolation tests extended to it.

| Step | What |
|------|------|
| 4A | Record the decisions in the docs; protocol document (`docs/board-protocol.md`); migrations for the board registry, pairing codes, broker identity and the validity window. |
| 4B | Broker access per board (dynamic security), the API's internal broker connection, online/offline status. |
| 4C | Commands and reports over MQTT; a simulated board that speaks the real protocol replaces the in-process simulator (`pnpm dev:board` keeps working). Daily energy totals from reports. The cleanup job. |
| 4D | Scenario runner on the server with validity windows; only the latest result kept; one-time scenarios deleted when over; the window in the scenario editor (three languages). |
| 4E | Pairing: the board's "waiting to be paired" call, uploading the QR code in the app, the screen to name the board's channels and choose rooms; factory reset that leaves nothing behind. |
| 4F | Exit: docs, a test with the international internet blocked, verification on a clean copy. |

## Out of scope

- Firmware and the board's setup page (Phases 6–7); the protocol document is their contract.
- Control from the app without internet, and any hub.
- Live camera video and recordings (later, with a media service).
- The energy chart screen (this phase only stores the daily totals).
- The real SMS provider, member invitations and realtime push to the browser.

## Confirmed details (2026-10-04)

1. **Wi-Fi setup:** the board's own temporary Wi-Fi and setup page (works in any phone browser). Bluetooth was rejected because it does not work in the web app on iPhones.
2. **Pairing QR code:** made by the board, fresh on every pairing mode, one use, valid 24 hours.
3. **Validity windows for scenarios:** never, 10 minutes (default), 1 hour, 3 hours.
4. **New dependencies, both bundled with our own code and never calling a foreign service:**
   - the `mqtt` npm package in the API (talks only to our own broker);
   - a small QR-reading library in the web app, to read the uploaded image.

## Exit (2026-10-04)

**Done:**
- **4A:** the decisions, the board protocol (document and shared code), the registry of manufactured boards, pending pairings, validity windows and daily energy totals in the database.
- **4B:** one broker account and one role per board, limited to that board's topics; online and offline status from the broker.
- **4C:** commands and reports over MQTT; simulated boards that are real broker clients; daily energy totals; the cleanup job.
- **4D:** scenarios run on the server, with a validity window per scenario; only the latest run is kept; one-time scenarios are deleted when over.
- **4E:** pairing by the board's own QR code and factory reset that leaves nothing behind; the "Add a device" screens, also in the demo with three sample boards.

**Differences from the plan:**
- Mosquitto 2.0 cannot limit publishing by username pattern, so each board has its own role that names its topics. The effect is the same.
- "Never run late" still allows 60 seconds, because the scheduler checks every 5 seconds and is always a little behind.
- A command that expired before the board answered stays timed out, but the state the board reported is stored, because that is what the hardware really did.

**Verified:**
- **On a clean copy with an empty database:** migrations, SQL tests, seed, API and contract tests, typecheck, lint and builds.
- **On the dev stack:** the browser flows:
  - sign-in, homes, devices and deadlines, languages, settings, time zones;
  - scenarios, with a real scheduled run by the server;
  - pairing with an uploaded QR code, then a real command to the new board;
  - pairing in the demo.
- **With every foreign host unreachable:** all screens in the three languages load with no request abroad and no failed request.

**Carried over:**
- **Firmware (Phases 6–7):** the ESP32 side of `docs/board-protocol.md`, including the board's setup page and its QR code.
- **Factory tooling:** writing real boards into the registry of manufactured boards (today only dev and test boards are written).
- **Production broker:** TLS with our own certificate authority, and a per-address rate limit on the board routes at the reverse proxy.
- **Removing a board from the app:** today a board leaves a home only by a factory reset or by pairing with another home.
- **Many API processes:** use MQTT shared subscriptions so each message is handled once (today every process handles it; that is harmless but wasteful).
- **Not started:** realtime push to open apps, the energy chart screen, the real SMS provider, member invitations.
