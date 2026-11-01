# Proposed board lineup and pin maps

Status: proposal (2026-11-01), for the PCB designer to check against the real circuits. All of it is in the hardware catalog (`supabase/migrations/202611040001_chips_and_board_lineup.sql`, model codes `m2-…-rev-a`). A model no installed board uses can still change in a later migration; once boards use it, it is frozen and a changed PCB becomes a new revision.

21 boards cover all 20 device types of the app. Each table lists every GPIO the board uses.

## Common design rules

- **Chips:**
  - ESP32-C3-MINI-1 for small boards (up to 8 GPIOs);
  - ESP32-WROOM-32 for boards with many inputs and outputs;
  - ESP32-CAM for the camera.
  - ESP-01 (ESP8266) is not used: one firmware (ESP-IDF) for every board.
- **Relays** are driven through a ULN2803. A GPIO **HIGH** turns the relay **on**: the ULN output then sinks to 0 V, which energises the coil. Every ULN input gets a 10 kΩ pull-down to GND, so relays never click while the chip boots. The ULN's COM pin goes to the coil supply (its built-in flyback diodes).
- **Key LEDs** are wired to the relays, so they always show the real relay state.
- **Touch keys** are TTP223 in **momentary** mode with **active-high** output (TOG and AHLB pads left open). The first touch key of a board is also its setup key ([board-protocol.md](board-protocol.md), "The setup key").
- **Push buttons and contacts** go to GND with a pull-up.
  - On WROOM GPIO 34–39 the pull-up must be an external 10 kΩ: these pins have none inside.
  - Elsewhere the internal pull-up is enough.
- **Never used:**
  - **WROOM:** GPIO 0, 2, 5, 12, 15 (boot straps), 1/3 (UART0, for flashing) and 6–11 (flash). GPIO 14 is input only (it pulses at boot).
  - **C3:** GPIO 2, 8, 9 (boot straps; 9 is the BOOT button), 18/19 (USB, for flashing) and 20/21 (UART0).
- **Free on the C3** (MINI-1): 0, 1, 3, 4, 5, 6, 7 and 10; ADC on 0–4.
- **Power:** mains boards use a 220 V → 5 V module (e.g. HLK-PM01) for the coils, and a 3.3 V LDO (≥ 500 mA, e.g. AMS1117 or better) for the chip. Wi-Fi peaks need the headroom.
- **Sensors are mains- or USB-powered** in this first generation. Battery sensors (deep sleep) come later.
- **Interlock:** relays in one interlock group (curtain open/close, fan and cooler low/high) are never on together. The catalog enforces it and the firmware checks it again.

## Lighting

### M2-T1 to M2-T4: touch switch, 1 to 4 keys (ESP32-C3)

One board per plate size. Key *n* switches relay *n*; key 1 is also the setup key. There is no separate status LED: the board blinks key 1's light.

| GPIO | M2-T1 | M2-T2 | M2-T3 | M2-T4 |
|------|-------|-------|-------|-------|
| 4 | relay 1 | relay 1 | relay 1 | relay 1 |
| 5 | | relay 2 | relay 2 | relay 2 |
| 6 | | | relay 3 | relay 3 |
| 7 | | | | relay 4 |
| 0 | touch 1 (setup) | touch 1 (setup) | touch 1 (setup) | touch 1 (setup) |
| 1 | | touch 2 | touch 2 | touch 2 |
| 3 | | | touch 3 | touch 3 |
| 10 | | | | touch 4 |

Channels: `switch` × 1–4.

### M2-R8: 8-relay panel board (ESP32-WROOM-32)

For the electrical panel. Each relay is its own switch, in its own room, all in one home. Eight inputs take touch keys (or push buttons) wired from the walls; input *n* switches relay *n*.

| GPIO | Function |
|------|----------|
| 4, 13, 16, 17, 18, 19, 21, 22 | relays 1–8 |
| 23, 25, 26, 27, 32 | key inputs 1–5 |
| 34, 35, 39 | key inputs 6–8 (external pull-up/down) |
| 36 | setup button (external 10 kΩ pull-up) |
| 33 | status LED (blinks in pairing mode) |

Channels: `switch` × 8.

### M2-D1 / M2-D2: dimmer, 1 or 2 channels (ESP32-C3)

A TRIAC per channel, with an optocoupler on the gate (MOC3021-type, random phase) and a zero-cross detector shared by both channels.

| GPIO | M2-D1 | M2-D2 |
|------|-------|-------|
| 4 | zero-cross in | zero-cross in |
| 5 | TRIAC gate 1 | TRIAC gate 1 |
| 6 | | TRIAC gate 2 |
| 0 | touch 1 (setup) | touch 1 (setup) |
| 1 | | touch 2 |

A touch toggles the light; a long touch under 7 s does not dim. Dimming is from the app. Channels: `dimmer` × 1–2.

## Climate

### M2-CL: evaporative cooler (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | pump relay |
| 5 | motor low relay (interlock group `speed`) |
| 6 | motor high relay (interlock group `speed`) |
| 7 | setup button |
| 10 | status LED |

Channel: `cooler` (pump, speed off/low/high). Pump and speed are restored after a power cut. Changing speed turns the old relay off 0.3 s before the new one comes on.

### M2-FN: fan (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | low relay (interlock group `speed`) |
| 5 | high relay (interlock group `speed`) |
| 0 | touch key (setup; a touch steps off → low → high → off) |

Channel: `fan` (speed off/low/high), restored after a power cut. Changing speed turns the old relay off 0.3 s before the new one comes on.

## Openings

### M2-CU: curtain (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | open relay (interlock group `motor`) |
| 5 | close relay (interlock group `motor`) |
| 0 | touch "open" (setup) |
| 1 | touch "close" |

A command or a touch runs the motor for the whole track (30 s in the firmware; the motor's own end stops halt it), then the board reports `open` or `closed`. Touching the other key reverses it, with a 0.6 s pause. After a power cut the motor stays still and the last position is kept. There is no stop in the middle: the app knows only open and closed. Channel: `curtain` (open/closed).

### M2-GD: parking door (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | pulse relay to the door controller (closes about 1 s) |
| 5 | door contact (reed or limit switch, closed = door closed) |
| 6 | setup button |
| 10 | status LED |

Channel: `garage_door`. The reported state comes from the contact, never from the pulse. A command for where the door already is completes at once, without a pulse. Otherwise the relay closes for 1 s, and the command completes when the contact shows the door there. A change from the door's own remote is reported too.

### M2-DO: door opener (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | strike relay |
| 5 | local push button (the strike is released while it is held; also the setup key) |

Channel: `door_opener`. From the app, one press releases the strike for 5 s.

## Power

### M2-SK: smart socket (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | relay (16 A for a socket) |
| 5 | push button (short press: on/off; also the setup key) |

Channel: `socket`. No power metering: the product shows no consumption figures.

### M2-PM: water pump (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | relay to the pump's contactor (never the pump directly) |
| 5 | push button (setup) |
| 6 | float switch, optional (open = tank empty: the board stops the pump by itself, against dry running) |

Channel: `pump`.

## Security

### M2-AL: alarm panel (ESP32-WROOM-32)

| GPIO | Function |
|------|----------|
| 4 | siren relay |
| 34, 35, 36, 39 | zones 1–4 (external pull-ups; NC contacts or PIR outputs) |
| 32, 33 | zones 5–6 |
| 25 | tamper switch of the box |
| 26 | setup button |
| 27 | status LED |

Channels:
- `alarm` (mode disarmed/home/away, triggered): the board decides when to sound the siren, even offline;
- six zones as `contact_sensor` or `motion_sensor`, set per installation model.

### M2-CAM: camera (ESP32-CAM, AI-Thinker)

| GPIO | Function |
|------|----------|
| camera bus | fixed by the module (OV2640) |
| 13 | setup button (the only free pin that is not a boot strap) |
| 33 | on-module red LED (status, active low) |

Channel: `camera` (on/off, recording). Live video comes in a later version. Recording needs the microSD slot, which shares pins 2, 4, 12–15 with the flash LED: the flash LED is not used.

## Sensors

### M2-RS: room sensor (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | I²C SDA |
| 5 | I²C SCL |
| 6 | PIR motion (AM312, 3.3 V output) |
| 7 | setup button |
| 10 | status LED |

On the I²C bus:
- SHT40 (humidity and temperature);
- BH1750 (light).

Channels: `humidity_sensor`, `light_sensor`, `motion_sensor`.

**M2-RS-AIR** is the same board with an SCD40 (CO₂) or SGP40 (VOC index) added on the bus, which adds `air_quality_sensor`. The sensor sits away from the chip's heat.

### M2-PR: presence sensor, mmWave (ESP32-C3)

| GPIO | Function |
|------|----------|
| 6 | UART1 RX ← LD2410 TX |
| 7 | UART1 TX → LD2410 RX |
| 4 | LD2410 OUT (presence, as a backup to UART) |
| 5 | setup button |

Channel: `presence_sensor`. Unlike PIR, it sees people who sit still. The firmware reads the OUT pin with the radar's factory settings; the UART is wired for tuning its range later.

### M2-CT: door and window contact (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | reed switch (closed = door closed) |
| 5 | setup button |

Channel: `contact_sensor`. USB-powered in this generation.

### M2-LK: water leak (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | leak probe, through a transistor stage (low = water) |
| 5 | buzzer |
| 6 | setup button |

Channel: `leak_sensor`. The buzzer sounds locally, even offline.

### M2-SM: smoke (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | relay contact of a certified smoke detector (closed = smoke) |
| 5 | setup button |

Channel: `smoke_sensor`. Smoke is detected by a certified detector, not by our own gas sensor (an MQ-2 is not reliable enough for fire), and the board reports its contact.

### M2-CO: carbon monoxide (ESP32-C3)

| GPIO | Function |
|------|----------|
| 4 | UART1 RX ← Winsen ZE07-CO TX (electrochemical cell, gives ppm) |
| 5 | UART1 TX → ZE07-CO RX |
| 6 | buzzer |
| 7 | setup button |

Channel: `co_sensor` (ppm). The buzzer sounds locally above 50 ppm. MQ-7 is not used: it is not reliable enough.

## In the catalog

| Model code | Board |
|------------|-------|
| `m2-t1-rev-a` … `m2-t4-rev-a` | Touch switch, 1–4 keys |
| `m2-r8-rev-a` | 8-relay panel board |
| `m2-d1-rev-a`, `m2-d2-rev-a` | Dimmer, 1 or 2 channels |
| `m2-cl-rev-a`, `m2-fn-rev-a` | Cooler, fan |
| `m2-cu-rev-a`, `m2-gd-rev-a`, `m2-do-rev-a` | Curtain, parking door, door opener |
| `m2-sk-rev-a`, `m2-pm-rev-a` | Smart socket, water pump |
| `m2-al-rev-a`, `m2-cam-rev-a` | Alarm panel, camera |
| `m2-rs-rev-a`, `m2-rs-air-rev-a` | Room sensor, with air quality |
| `m2-pr-rev-a`, `m2-ct-rev-a`, `m2-lk-rev-a`, `m2-sm-rev-a`, `m2-co-rev-a` | Presence, door and window, leak, smoke, carbon monoxide |

Status LEDs and buzzers are in the catalog as `digital_out` pins. The ESP32-CAM's camera bus is fixed by the module and not listed.
