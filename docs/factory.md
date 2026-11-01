# Producing boards

Every board leaves the factory with:
- the production firmware for its model;
- its own **factory identity**: a hardware id and a random factory secret, in the `m2factory` flash partition, which a factory reset never erases.

The server's registry of manufactured boards keeps only each secret's SHA-256. A board that is not in the registry, or does not know its secret, can never join a home ([board-protocol.md](board-protocol.md), "Pairing").

## 1. Build the firmware for the model

`main/board.c` has the model's pin table (one build per model). Copy the server's board CA to `firmware/certs/board_ca.pem`, then:

```sh
sh firmware/build.sh t2     # the model's board: t1-t4, r8, sk, do, pm
```

The flash files land in `firmware/dist/<board>/`. Upload the same `m2smart-board.bin` in the admin panel → Firmware, so the boards' later updates start from it.

## 2. Register a batch

Each board gets an id like `M2-T2-REV-A-1F3A9C07`. Its last 4 characters name its setup network, `M2smart-9C07`. The batch folder holds one factory-partition file per board and a `manifest.csv`.

**On the production server** (in the API image, like the migrations):

```sh
mkdir -p factory
docker compose -f infra/prod/compose.yaml --env-file infra/prod/.env run --rm --user root \
  -v "$PWD/factory:/factory" migrate node backend/dist/tools/factory-batch.js m2-t2-rev-a 500 /factory/t2-batch-01
```

Copy `factory/t2-batch-01` to the factory PC over a safe channel, then delete it on the server.

**In development:** `pnpm factory:batch m2-t2-rev-a 10` (the folder is printed).

## 3. Make the factory images

```sh
sh firmware/factory/make-bins.sh <batch folder>
```

This writes a `<id>.bin` next to each `<id>.csv`, using Espressif's tool in Docker.

## 4. Flash the boards

On the factory PC (Windows, with esptool from the Arduino IDE or `pip install esptool`):

```powershell
.\firmware\factory\flash-batch.ps1 -Batch <batch folder> -Board t2 -Port COM5
```

The script works through the batch one board at a time:
- it asks you to connect the next board;
- it writes the firmware and that board's own identity;
- it records the board in `flashed.csv`.

You can stop and start again: flashed boards are skipped. Label each board with the id the script shows. The script picks the chip from the board (ESP32-C3 for t1–t4, sk, do, pm; ESP32 for r8).

## 5. Delete the batch

The batch folder holds every board's secret. **Once every board is flashed, delete the whole folder.** Nothing else needs it: the server has the hashes.

## Safety notes

- A secret that leaks lets someone make a fake board with that id, but only for that one board. The server never stores the secrets themselves.
- Boards that are lost or scrapped can stay in the registry: they never join a home without being held.
