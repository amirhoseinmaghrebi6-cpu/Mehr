# Board protocol (version 1)

How an M2smart ESP32 board talks to the cloud. There is no hub: every board connects straight to our MQTT broker in Iran. This document is the contract for the firmware (Phases 6–7); the message shapes live as code in `packages/contracts/src/board-protocol.ts`, and the API and the simulated board use that file.

Status: the messages, the database, broker accounts, online/offline status and the command and report path are in place (Phases 4A–4D), tested with simulated boards. Scenarios run on the server (4D); pairing and factory reset are in place (4E). Everything is tested with simulated boards; the firmware follows this document of [plans/phase-4.md](plans/phase-4.md).

## Rules the board always follows

- **A command is done only when the board reports the real state.** The server never assumes.
- **Wall switches work without internet.** The board toggles its own relay, then reports when it can.
- **Relays keep their last state** after a power loss or a restart.
- **The board has no clock.** It never needs the time of day; commands carry how long they are still valid.
- **No schedules on the board.** Scenarios run on the server.
- **Interlocks** (e.g. a curtain's open and close relays) are enforced on the board itself.

## Connection

| Item | Value |
|------|-------|
| Transport | MQTT 3.1.1 over TLS, to our own broker; the firmware trusts our own certificate authority |
| Username | the board id it received at pairing |
| Password | the broker secret it received at pairing |
| Client id | the board id |
| Keep-alive | 30 s |
| QoS | 1 for every message |
| Last will | topic `status`, payload `{"online":false}`, retained |

A board may publish and subscribe only on its own topics; the broker refuses anything else.

**On every connect** the board:
1. subscribes to its `cmd` topic;
2. publishes `status` `{"online":true,"fw":"<version>"}`, retained;
3. publishes one `state` message with the current value of every capability of every channel.

Connecting is how the server learns that power or internet is back. It then sends any commands that are still valid.

**When the connection is lost** the board keeps working locally and reconnects with a growing delay (1 s, 2 s, 4 s … up to 60 s).

## Topics and messages

All topics are `m2/v1/boards/{boardId}/{kind}`. Messages are small JSON objects with no extra fields.

| Kind | Direction | Retained | Payload |
|------|-----------|----------|---------|
| `cmd` | server → board | no | `{"id":"<command id>","ch":"ch1","cap":"power","val":true,"ttl":30}` |
| `ack` | board → server | no | `{"id":"<command id>"}`, or `{"id":"<command id>","err":"camera_off"}` to refuse |
| `state` | board → server | no | `{"id":"<command id>","values":[{"ch":"ch1","cap":"power","val":true}]}`; `id` only when the values complete a command |
| `status` | board → server | yes | `{"online":true,"fw":"1.0.0"}` or `{"online":false}` |
| `reset` | board → server | no | `{}` just before a factory reset, if the board is online |

- **`ch`** is the channel key of the board model (one of its 1 to 20 inputs and outputs), from the hardware catalog.
- **`cap`** and **`val`** are a capability and an absolute value from the device catalog (`power` true/false, `brightness` 0–100, `speed` off/low/high, `curtain` open/closed …). Never a difference.
- **`ttl`** is how many seconds the command is still valid.

### Carrying out a command

1. The board receives `cmd`.
2. If it cannot do it, it publishes `ack` with `err` and stops.
   - Unknown channel or capability: `unknown_target`.
   - A value that does not fit: `invalid_value`.
   - A camera asked to record while off: `camera_off`.
3. Otherwise it starts the hardware and publishes `ack` with only the id.
4. When the hardware has reached the value, it publishes `state` with the command's id and the value it really has.
   - A parking door reports only when its sensor shows the door open or closed.
   - A camera switched off also reports `recording` false in the same message.
5. If the same command id arrives again, the board repeats its last answer and does not run the hardware twice.
6. If `ttl` has passed before the hardware could start, the board drops the command silently; the server marks it timed out.

A board carries out the commands of one channel one after another, in the order received.

### Reports without a command

A wall-switch press or a sensor change is a `state` message without `id`. Sensors report when the value changes meaningfully, and at least every 10 minutes while connected.


## The setup button

| Held for | The board |
|----------|-----------|
| under 10 s | does nothing |
| 10–15 s, then released | enters **pairing mode** for 5 minutes (status LED blinks slowly) |
| 15–20 s | does nothing, so pairing never turns into a reset by accident (LED steady) |
| over 20 s | does a **factory reset** as soon as 20 s is reached (LED blinks fast, then restart) |

## Pairing

Nothing is printed on the product. The board makes its own pairing code.

1. **Pairing mode.** The board makes a fresh random pairing code (26 characters from `A–Z` and `2–7`). Any earlier code is forgotten. It opens a temporary Wi-Fi access point with a setup page.
2. **Setup page** (served by the board, no internet needed):
   - asks for the home's Wi-Fi name and password;
   - shows the pairing code as a QR code and as text, for the user to save: `M2P1:{hardware id}:{code}`.
3. **Announce.** The board joins the home's Wi-Fi and calls `POST /v1/boards/announce` over HTTPS with `{"hardwareUid", "secret", "codeHash"}`: its hardware id, its factory secret and the SHA-256 (hex) of the pairing code. The answer is 204, or 401 for a board the registry does not know. The server now knows a genuine board is waiting; it stores only the hash, for at most 24 hours.
4. **Confirm.** An owner or admin uploads the QR code (or pastes the text) in the app, in the home they choose. The server adds the board and all its channels to that home.
5. **Credentials.** The board calls `POST /v1/boards/credentials` with `{"hardwareUid", "secret", "code"}` every few seconds. Until step 4 has happened the answer is 202 `{"status":"waiting"}`; then it is 200 `{"status":"paired","boardId","brokerSecret"}`. Every such answer carries a fresh broker secret and ends the earlier one, so a board whose answer got lost simply asks again. A wrong secret or code gets 401.
6. The board stores the credentials, closes the access point and connects to the broker.

A pairing code works once. After 24 hours unused, it is deleted; holding the button again gives a new one.

The factory secret is a random value written to the board at production. It proves the board is genuine, and it is the only thing that survives a factory reset.

## Factory reset

1. If the board is online, it publishes `reset` (best effort).
2. It erases its broker secret, its Wi-Fi settings and any pairing code. The factory secret and hardware id stay.
3. It restarts, like new.

The server then deletes everything about the board: the board, its devices, their states and commands, and the scenario actions that used them. Nothing is kept. If the server never hears of the reset, pairing the board with any home removes it from the old one.

**Removed in the app.** An owner or admin can also remove a board from the app. The server does the same as for a reset and closes the board's broker account, so the board's connection is refused from then on. A board that is refused keeps obeying its wall switches and waits for its setup button: pairing mode makes it a new board for any home.

## Firmware base

Built on Espressif's official ESP-IDF components (Wi-Fi, HTTP server, TLS, MQTT, storage). The setup page, the pairing and reset logic and this protocol are M2smart's own code. No third-party Wi-Fi manager library. Time sync, firmware updates and certificates all come from our own servers in Iran.
