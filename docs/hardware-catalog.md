# Hardware catalog: adding an M2smart board

Every M2smart device is one channel of an M2smart ESP32 board. What each GPIO does is fixed by the PCB design, so it is recorded once, in the hardware catalog in PostgreSQL, and never by users.

- **Adding a board to a home:**
  - A board added to a home (a "controller") gets its devices from its model automatically.
  - Users can rename a device and move it between rooms. That is all they can change.
- **Access:**
  - Only M2smart edits the catalog, through migrations.
  - Users can read model names and channels, but not pin maps, capability templates or interlocks.

The rules below are enforced by the database (`supabase/migrations/202610020002_hardware_catalog_and_controllers.sql` and `202610030001_command_timing.sql`). A model that breaks one is rejected when it is inserted.

## The model

| Table | One row per | Holds |
|-------|-------------|-------|
| `hardware_models` | board model and revision | `code` (e.g. `switch-2ch-rev-a`), `name`, `chip` (`esp32`) |
| `hardware_model_channels` | device on the board | `channel_key`, `device_type`, `default_name`, optional `action_seconds` |
| `hardware_model_pins` | GPIO | `gpio`, `function`, `channel_key` (null = shared by the board, e.g. an I2C bus), `role` |
| `hardware_model_capabilities` | capability of a channel | the same fields as `device_capabilities`: type, range, enum values, unit, writable |
| `hardware_model_interlocks` | relay in a group | relays of one `group_key` must never be on together |

## Rules

### Pins

Each GPIO appears once per model, so no pin can serve two purposes. Allowed pins on the ESP32 (WROOM-32):

| Function | Allowed GPIO |
|----------|--------------|
| `relay`, `triac_gate`, `i2c_sda`, `i2c_scl`, `uart_tx` | 4, 13, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33 |
| `digital_in`, `zero_cross`, `pulse_in`, `uart_rx`, `setup_button` | the above, plus 14 and 34–39 |
| `adc` | 32–39 (ADC1; ADC2 does not work while Wi-Fi is on) |

- **Never allowed:**
  - 6–11 (SPI flash)
  - 1 and 3 (UART0)
  - 0, 2, 5, 12 and 15 (boot-strapping pins)
- **Not allowed as an output:** 14 (it pulses at boot and could click a relay).
- **On WROVER modules,** 16 and 17 are wired to PSRAM, so don't use them there.
- **Other chips** (ESP32-S3, -C3) need their own pin list in `esp32_pin_allowed()` before they can be used.

### Setup button

- **Exactly one per model.** Every board has one push button on a GPIO, function `setup_button`, used by the firmware:
  - held 10–15 s: pairing mode for 5 minutes;
  - held 15–20 s: nothing;
  - held over 20 s: factory reset.
- **Required to join a home.** A model without one cannot be added to a home, and a second one is rejected.
- **Not on GPIO 0:** that pin is the dev kit's BOOT button, and holding it during power-up starts the flasher.
- **The full rules** for ownership (whoever holds the board owns it), pairing and reset are in [plans/phase-3-5.md](plans/phase-3-5.md), section A.

### Frozen models

A model that any installed board uses cannot change, and cannot be deleted. A new PCB revision is a new model with a new `code`.

### Device types and capabilities

A channel's `device_type` must exist in `device_types`. Its capabilities must follow `packages/contracts/src/catalog.ts`: the required capabilities of the type, plus any of its optional ones.

`backend/test/catalog-sync.test.ts` checks that the database and the contracts agree.

### Command deadlines

A command expires 30 s (network allowance) plus the channel's `action_seconds` after it is sent. If the channel has no `action_seconds`, the device type's default applies:

| Device type | Default |
|-------------|---------|
| parking door | 120 s |
| curtain | 90 s |
| cooler, fan | 10 s |
| everything else | 0 s |

Set `action_seconds` from the real motor, with some margin. A command is applied only when the ESP32 reports the new value before its deadline.

### Interlocks

Interlocks are stored as data so the firmware, the hub and the simulator can enforce them on the device itself, with or without internet. Examples:
- a cooler's low and high relays;
- a curtain's open and close relays.

## Example: a 2-channel relay switch

Write a new migration (e.g. `supabase/migrations/2026MMDD0001_catalog_switch_2ch_rev_a.sql`). Never edit an applied one.

```sql
with model as (
  insert into public.hardware_models (code, name) values ('switch-2ch-rev-a', 'Relay switch, 2 channels')
  returning id
), channels as (
  insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name)
  select id, channel_key, 'switch', default_name from model,
    (values ('ch1', 'Switch 1'), ('ch2', 'Switch 2')) as channel (channel_key, default_name)
  returning model_id, channel_key
), pins as (
  insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role)
  select id, gpio, function, channel_key, role from model,
    (values (16, 'relay', 'ch1', 'relay'), (17, 'relay', 'ch2', 'relay'),
            (32, 'digital_in', 'ch1', 'wall_switch'), (33, 'digital_in', 'ch2', 'wall_switch'),
            (35, 'setup_button', null, 'setup'))
      as pin (gpio, function, channel_key, role)
  returning model_id
)
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, writable)
select model_id, channel_key, 'power', 'boolean', true from channels;
```

For a cooler, add the interlock:

```sql
insert into public.hardware_model_interlocks (model_id, group_key, gpio)
select id, 'speed', gpio from public.hardware_models, (values (17), (18)) as relay (gpio)
where code = 'cooler-rev-a';
```

## Adding a new device type

1. Add the type and its capabilities to `packages/contracts/src/catalog.ts`.
2. Add the type in a new migration: `insert into public.device_types (type, action_seconds) values (...)`.
3. Add its icon and English/Persian names to `lib/device-ui.ts`, and its one-tap action if it has one.
4. Run `pnpm db:migrate`, `pnpm db:test` and `pnpm --filter @m2smart/api test`. The catalog sync test fails if step 1 and step 2 disagree.

## Trying a model in development

`pnpm dev:board <home-id> <model-code>` adds a simulated board of that model to a home. With `M2SMART_DEV_HUB_SIMULATOR=true`, the API's dev simulator then plays the ESP32 for it: it confirms commands after the hardware's time, and `POST /internal/dev/report` simulates wall switches and sensors.

The `sample-*` models from `pnpm db:seed` are examples for development only. They are not real M2smart PCBs.

Real boards are added through the hub by scanning the board's QR code (Phase 4).
