# M2smart board firmware

ESP-IDF v5.4 firmware for M2smart boards. It follows [docs/board-protocol.md](../docs/board-protocol.md), and every board shares the same code. The board's channels and pins are in `main/board.c`; today that is the DevKit test board, and production boards get their own table there when their PCBs are final ([docs/board-lineup.md](../docs/board-lineup.md)).

What it does:
- **Power-up:** applies the saved relay states at once, then the keys work, then it joins Wi-Fi and the broker.
- **Keys:** a touch switches its channel; the setup key held 7–10 s starts pairing; held over 15 s within 3 minutes after power-up, it does a factory reset.
- **Pairing mode:** opens the network `M2smart-XXXX` with a setup page at `http://192.168.4.1` (home Wi-Fi and setup code), claims with the code, then restarts paired. A paired board can also change only its Wi-Fi there: it keeps the new one only after reaching our server over it.
- **Updates over the air:** it takes `update` from the broker, downloads the image over HTTPS and checks its SHA-256. It writes the image to the other slot and restarts, and goes back to the previous firmware if the new one cannot reach the broker within 5 minutes.
- **Broker:** MQTT, over TLS to our own certificate authority. It reports online, takes commands, acknowledges them and reports the result. It reports every key press, and every channel on connect.

| File | Does |
|------|------|
| `main/app_main.c` | Power-up order |
| `main/board.c` | The board's channels and pins |
| `main/channels.c` | Relays, saved states, blinking |
| `main/keys.c` | Touch keys and the setup key |
| `main/net.c` | Wi-Fi |
| `main/setup_mode.c`, `main/setup_page.html` | Pairing mode and its page |
| `main/claim.c` | `POST /api/v1/boards/claim` |
| `main/cloud.c` | MQTT |
| `main/ota.c` | Firmware updates and rollback |
| `main/storage.c` | Flash: the `nvs` partition (erased by a factory reset) and `m2factory` (never erased) |

## Build

The build runs in Espressif's Docker image, so nothing but Docker has to be installed. `build.sh` keeps the build folder and the compiler cache in Docker volumes, so after the first build (a few minutes) a build takes about half a minute. It copies what flashing needs to `firmware/dist/`.

Before the first build, copy the board CA (see `certs/README.md`):

```sh
cp infra/prod/certs/ca/ca.crt firmware/certs/board_ca.pem
```

```sh
sh firmware/build.sh t2          # one board, for production (m2smart.ir)
sh firmware/build.sh devkit dev  # the DevKit against the dev stack on your PC
```

Boards: `devkit`, `t1`–`t4` (touch switches), `r8` (8-relay panel), `sk` (socket), `do` (door opener), `pm` (water pump), `cl` (cooler), `fn` (fan), `cu` (curtain), `gd` (parking door), `ct` (door and window), `lk` (water leak), `sm` (smoke), `pr` (presence). Each has its own chip, pin table (`main/board.c`) and output folder, `firmware/dist/<board>/`.

For `dev`, first copy `sdkconfig.dev.example` to `sdkconfig.dev` and put your PC's address on the home network in it.

## Test the motor logic on a PC

`sh firmware/test/run.sh` runs `main/channels.c` against stubbed pins and timers for the fan, cooler, curtain, parking door, leak sensor and door contact. It checks every relay change, so it fails if a motor's two relays are ever on together.

## Provision and flash a DevKit

1. **Wire the DevKit** (ESP32-WROOM-32):
   - an LED with a 220 Ω resistor from GPIO 16 to GND (relay 1), and another from GPIO 17 (relay 2);
   - push buttons from GPIO 32 (key 1, also the setup key) and GPIO 33 (key 2) to GND.
   - TTP223 modules instead of buttons: output to GPIO 32/33, VCC to 3.3 V, GND to GND, and `CONFIG_M2_KEYS_TTP223=y` in `sdkconfig.dev`.
2. **Give it a factory identity:** `pnpm dev:devkit` registers a new board (`KIT-…`) and writes `firmware/provision/KIT-….csv`. The next `sh firmware/build.sh devkit dev` turns it into `KIT-….bin`.
3. **Flash it** from Windows: Docker cannot reach the USB port, so this step runs outside Docker.
   - **esptool** comes with the Arduino IDE's ESP32 package: `%LOCALAPPDATA%\Arduino15\packages\esp32\tools\esptool_py\4.5.1\esptool.exe`. A `pip install esptool` works too.
   - **The USB driver** (CP210x or CH340) is there already if the Arduino IDE has uploaded to this DevKit.
   - From `firmware/dist/devkit`, with your COM port (the Arduino IDE shows it under Tools → Port):

   ```bat
   "%LOCALAPPDATA%\Arduino15\packages\esp32\tools\esptool_py\4.5.1\esptool.exe" --chip esp32 -p COM5 -b 460800 write_flash @flash_args 0xF000 ..\..\provision\KIT-XXXX.bin
   ```

   The first flash writes the factory partition (`0xF000 …bin`). Later flashes leave it out: the board keeps its identity, Wi-Fi and pairing.
4. **Watch it run:** the Arduino IDE's Serial Monitor at 115200 baud shows the board's log.

## Producing boards

Factory batches (an identity per board) and flashing them one after another: [docs/factory.md](../docs/factory.md) and `firmware/factory/`.

## Releasing a new version

1. Raise `PROJECT_VER` in `firmware/CMakeLists.txt`, for example `0.1.0` → `0.2.0`.
2. Run `sh firmware/build.sh <board>` for production, once per board model.
3. In the admin panel → Firmware, pick the board model, upload `firmware/dist/<board>/m2smart-board.bin` and publish it. The panel reads the version and the model from the file.

## Try it with the dev stack

1. Open the dev broker to the home network: set `MQTT_HOST_BIND=0.0.0.0` in `infra/dev/.env`, then run `pnpm infra:up`. When Windows asks, allow port 18830. Put it back to 127.0.0.1 when you are done.
2. Run `pnpm api:dev` and `pnpm dev` (the web app is reachable from the network on port 3000).
3. In the app: **Add device → DevKit test board, 2 channels → Add**. The app shows a setup code.
4. Hold key 1 for 7–10 s and let go. The LED blinks twice and the board opens `M2smart-XXXX`.
5. Join that network with your phone, go back to the app and tap **Open the board's page**. Enter your home Wi-Fi name and password there.
6. The board joins, claims and restarts; the app says the board is paired. Now the LEDs follow the app, and the keys switch them and show up in the app.
7. **Factory reset:** unplug and plug in the DevKit, then hold key 1 for over 15 s within 3 minutes. The board disappears from the app.
