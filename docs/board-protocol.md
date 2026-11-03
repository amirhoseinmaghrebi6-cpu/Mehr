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

**When the connection is lost** the board keeps working locally and reconnects with a growing delay (1 s, 2 s, 4 s … up to 60 s). Each wait is spread at random over its second half, so boards that lost the broker together do not all come back in the same second. A board whose login the broker refuses 5 times (removed in the app) asks only once an hour, in case the refusal was the server's fault.

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
   - A door opener (`door_release`, a push button) pulses the strike's relay, then reports `"open"` once the door is released. Every press is a new command with the same value; the value is not a lasting state, and the app does not show it.
5. If the same command id arrives again, the board repeats its last answer and does not run the hardware twice.
6. If `ttl` has passed before the hardware could start, the board drops the command silently; the server marks it timed out.

A board carries out the commands of one channel one after another, in the order received.

### Reports without a command

A wall-switch press or a sensor change is a `state` message without `id`. Sensors report when the value changes meaningfully, and at least every 10 minutes while connected.


## The setup key

Boards with touch keys (TTP223, momentary mode) use their **first key** as the setup key; the
other keys only switch. Boards without touch keys (sockets, sensors) have a setup button. Both
behave the same:

| Touch or press | The board |
|----------------|-----------|
| short (under 7 s) | switches the key's channel on or off, at the touch (touch keys only) |
| 7–10 s, then released | enters **pairing mode** for 5 minutes; the channel's light blinks twice |
| 10–15 s | does nothing, so pairing never turns into a reset by accident |
| over 15 s, **within 3 minutes after power-up** | does a **factory reset** as soon as 15 s is reached; the light blinks 3 times, then the board restarts |
| over 15 s, later | does nothing |

The 3-minute window makes an accidental reset (water on a touch key, cleaning, a child leaning
on the switch) impossible: to reset, turn the circuit breaker off and on, then hold the key. The
key's LED is wired to its relay, so the board shows these steps by blinking the light itself.

## Power and connection

- The board saves each channel's state in its flash whenever it changes.
- **Power comes back:** the board applies the saved states at once, even with no internet (the
  modem may start later). Touch keys work from the first second.
- **Connected again** (after power or internet was lost): the board takes the last state the user
  or a scenario set on the server, applies it, and reports.

## Pairing

Nothing is printed on the product, and the board has no screen. The app gives a short setup code and the board takes it, so the user never has to carry a code from the board to the app.

1. **In the app.** An owner or admin picks the product and names and places its channels; they wait in the home ("awaiting pairing"). The app then asks for a setup code (`POST /v1/properties/{home}/boards/{board}/setup-code`) and shows it as `XXXX-XXXX-XXXX`.
   - 12 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0/O or 1/I), about 60 random bits.
   - Valid once and for 10 minutes, for this waiting board only. Asking again gives a new code and ends the earlier one. No two waiting codes are ever the same. The server stores only the SHA-256.
2. **Pairing mode.** The user holds the board's setup key for 7–10 seconds. The board opens a temporary Wi-Fi access point named `M2smart-…`, with a setup page at `http://192.168.4.1`.
3. **Setup page** (served by the board, no internet needed). The user's phone joins the board's Wi-Fi, and the user taps "Open the board's page" in the app. That opens `http://192.168.4.1/?code=XXXXXXXXXXXX`, so the code is filled in already. The page asks for:
   - the home's Wi-Fi name and password (only 2.4 GHz networks are listed; the page says so). If the installer saved this home's Wi-Fi in the app, the link carries it after `#` (`#ssid=…&pw=…`): it is kept only on that phone, the browser never sends a fragment, and our server never sees it;
   - the setup code: filled in from the link, or typed. Typing accepts any case, spaces and dashes.
4. **Claim.** The board joins the home's Wi-Fi and calls `POST /v1/boards/claim` over HTTPS with `{"hardwareUid", "secret", "code"}`: its hardware id, its factory secret and the setup code.
   - **200** `{"boardId", "brokerSecret"}`: the board is now the waiting board of that home. The waiting devices keep their names, rooms and scenario actions and become real. If it was in another home, it leaves it.
   - **401**: not a genuine board, or not a waiting code (wrong, used by another board, or expired). The page asks the user to check the code, or to get a new one in the app.
   - **409**: the code waits for a different product. The page tells the user they picked the wrong product in the app.
   - **429**: this board had 5 wrong answers in the last hour. It waits, then tries again.
   - Asking again with the same code (the answer got lost) gives a fresh broker secret and ends the earlier one, until the code expires.
5. The board stores the credentials, closes the access point and connects to the broker. The app sees the devices stop waiting (live updates) and says the board is paired.

Why it is safe at any scale: a guess has a chance of about one in a billion even with thousands of codes waiting at once. Each board gets 5 wrong tries an hour. A code works for one board of the right product, only for 10 minutes. Only a genuine board (with its factory secret) can use one.

The factory secret is a random value written to the board at production. It proves the board is genuine, and it is the only thing that survives a factory reset.

## Changing the Wi-Fi

When the router or its password changes, the board goes offline; the app tells the user how to fix it. The user puts the board in pairing mode (setup key 7–10 s) and opens its page. A board that is already paired offers two choices:

- **Change only the Wi-Fi** (the default): no code. The page sends `{"ssid", "password", "mode": "wifi"}`. The board joins the new Wi-Fi and checks that our server answers on it (state `checking`). Only then does it save it (state `wifi_changed`) and restart in the same home, with the same names, rooms and scenarios. If the Wi-Fi or the server fails, it reports `wifi_failed` or `no_server` and goes back to the Wi-Fi it had, so a typo never cuts it off.
- **Move to another home**: pairing with a setup code, as above. A link from the app with a code picks this one.

`GET /status` returns `{"state", "paired"}`; `mode: "wifi"` is refused on a board that is not paired.

## Firmware updates

A board gets new firmware over the air, from our own server.

1. **Upload:** an operator uploads the **signed** file in the admin panel (Firmware).
   - **Signing:** on the development machine, `node firmware/sign.mjs <board>` signs the image with our firmware key (ECDSA P-256) and writes `.m2fw`: the image, then the signature. The private key is encrypted with a passphrase and kept offline; it never reaches the server.
   - The server checks the signature with the key's public half (`FIRMWARE_PUBLIC_KEY_FILE`) and refuses anything unsigned, signed with another key, or changed after signing.
   - The server reads the **version** from the image's ESP-IDF app description.
   - It reads the **board model** from the marker `M2MODEL=<code>;` that every firmware carries (`firmware/main/board.c`).
   - A file that is not our firmware, or one built for another model, is refused, so a wrong version or another board's firmware can never be sent.
2. **Publish:** the operator makes a version active. One version per model is active at a time.
3. **Offer:** the server sends `update` to every online board of that model that reported another version in its `status`.
   - A board that is offline gets it when it comes online.
   - Payload: `{"version", "path", "sha256", "size", "sig"}`, where `path` is `/api/v1/firmware/{id}.bin` and `sig` is the base64 signature.
4. **Install:** the board downloads `path` from the server it claimed at, over HTTPS, and checks the size and the SHA-256 against the message.
   - It then checks `sig` against the public key built into its firmware. Without our signature it installs nothing, so even someone who takes over the server, the broker or an operator's account cannot put their own firmware on the boards.
   - It writes the image to its other firmware slot; `esp_ota_end` also checks the image's own format and checksum.
   - Then it restarts. Relays and keys keep working during the download. A failed download changes nothing, and the offer comes again at the next connection.
5. **Prove:** the new firmware is kept only once it reaches the broker. If it cannot within 5 minutes, or it crashes first, the board goes back to the firmware it had (ESP-IDF app rollback).
6. **Done:** the board's next `status` reports the new version, and the panel counts boards by version.

The image needs no account to download: it is the same code that is in every board. Only an active release can be downloaded.

**The signing key** is made once (`node firmware/sign.mjs keygen`) and must never be lost: boards trust only its public half, which is in their firmware, so without the private key and its passphrase no board already sold can ever be updated. Keep two offline copies. Changing the key would need a firmware, signed with the old key, that carries the new public key.

## Factory reset

1. If the board is online, it publishes `reset` (best effort).
2. It erases its broker secret and its Wi-Fi settings. The factory secret and hardware id stay.
3. It restarts, like new.

The server then deletes everything about the board: the board, its devices, their states and commands, and the scenario actions that used them. Nothing is kept. If the server never hears of the reset, pairing the board with any home removes it from the old one.

**Removed in the app.** An owner or admin can also remove a board from the app. The server does the same as for a reset and closes the board's broker account, so the board's connection is refused from then on. A board that is refused keeps obeying its wall switches and waits for its setup button: pairing mode makes it a new board for any home.

## Firmware base

Built on Espressif's official ESP-IDF components (Wi-Fi, HTTP server, TLS, MQTT, storage). The setup page, the pairing and reset logic and this protocol are M2smart's own code. No third-party Wi-Fi manager library. Time sync, firmware updates and certificates all come from our own servers in Iran.
