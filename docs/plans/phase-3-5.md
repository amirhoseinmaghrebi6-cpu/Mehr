# Phase 3.5 plan: device lifecycle, settings, languages and scenarios

Status: approved 2026-10-04; B, C, D, E1 and E2 implemented (A is built in Phase 4). Comes before Phase 4 (hub), because the pairing and reset rules below are what Phase 4 builds on.

## Requirements from the product owner (2026-09-29)

1. **Owning a board means holding it.** The owner of a board is whoever has it physically.
   - Every board gets a push button on a GPIO.
   - Holding it for 10–15 s starts pairing.
   - Holding it for more than 20 s is a factory reset.
   - A factory reset must remove all access of the previous user and of every other user of that home.
2. **New device types:**
   - pump: on/off only;
   - camera: on/off plus recording on/off.
3. **Each device's icon must match exactly what the device does.**
4. **Calendar:** the user picks Solar Hijri or Gregorian in settings.
5. **Three kinds of scenarios:**
   - **Periodic:** e.g. a switch turns on every Saturday and Tuesday at 15:00.
   - **One-time:** e.g. a device turns on on 20 Mordad 1407.
   - **Themed:** e.g. "Morning" turns lights off and the camera on; "Party" turns lights on and the camera off.
6. **Time and date follow where the device is.** If the user is in Turkey and the home is in Iran, the scenario runs on Iran's time and date.
7. **Languages:** the whole app in Persian, English and Arabic.
8. **Units** are chosen in settings (°C/°F and so on), and every value is shown in the chosen unit.

---

## A. Board lifecycle: ownership, pairing, factory reset

This part defines the contract that Phase 4 (hub), the firmware and the database all follow.

### The setup button

| Held for | What the board does | Feedback |
|----------|---------------------|----------|
| < 10 s | nothing (normal press is ignored) | — |
| 10–15 s, then released | **pairing mode** for 5 minutes | status LED blinks slowly |
| 15–20 s | nothing, so a pairing attempt never turns into a reset by accident | LED steady |
| > 20 s | **factory reset** as soon as 20 s is reached | LED blinks fast, then the board restarts |

The button is part of the PCB design, so the hardware catalog records it:
- a new pin function `setup_button`;
- the database requires exactly one `setup_button` pin in every new board model;
- models without one cannot be added to a home.

### Pairing

A board joins a home only when all three of these are true:

1. **Someone holds it.** The board is in pairing mode, which proves physical possession.
2. **It is on the home's local network.** The home's hub finds it on the LAN. There is no pairing over the internet.
3. **An owner or admin of that home confirms it in the app.** The QR code on the board picks the right board from the list, but a QR code alone never pairs anything, so a photo of a QR code is useless.

At pairing, the board gets a fresh secret key shared only with its hub. Any earlier key it had stops working.

### Factory reset

**On the board itself** (works without internet or hub):
- it erases its keys, its Wi-Fi settings, its stored states and any schedules it holds;
- then it is like new.

**In the cloud**, as soon as the hub or the cloud learns of the reset:
- the board, its devices, their states and command history are deleted from the old home;
- this cuts off all members of that home;
- the old home keeps only an audit entry ("board X was reset and removed", with the time);
- the home's owners and admins are notified.

**If the old home never hears of it** (e.g. the board was taken away):
- the next pairing with any home removes it from the old home automatically, because `hardware_uid` is unique;
- the old home's key already stopped working when the board erased it, so the old home cannot control it in between.

**Accepted risk:** anyone who can hold the button for 20 s can take a board over. That is the chosen rule (owning = holding), made visible by the notification to the old home.

---

## B. Catalog: pump and camera, and icons

- **New device types:**
  - `pump`: `power` on/off; typical action time 0 s.
  - `camera`: `power` on/off and `recording` on/off.
- **Camera limits:** a recording command only makes sense while the camera is on. Video streaming and viewing need a separate media service and come later; this phase only controls the camera.
- **Icon review:** every type gets an icon of what it does, reviewed together in one screen. Examples: pump = water pump/droplets flow, camera = CCTV camera, parking door = garage door, cooler = cooler/fan with water, dimmer = bulb with brightness.

## C. Languages: Persian, English, Arabic

- **Message files:** all text moves out of the components into message files: `messages/fa.ts`, `messages/en.ts`, `messages/ar.ts`.
  - They are type-checked: a key missing in any language fails the build.
- **Right to left:** Arabic uses RTL, like Persian.
- **Digits follow the language**, through the built-in `Intl.NumberFormat` with the numbering system set explicitly (no hand-written digit tables):
  - Persian: ۰۱۲۳ (`fa-u-nu-arabext`)
  - Arabic: ٠١٢٣ (`ar-u-nu-arab`)
  - English: 0123 (`en`)
- **Sign-in screens** and error messages get all three languages too.

## D. User settings

Stored on the user's account, so they follow the user to every device and browser:

| Setting | Choices | Default |
|---------|---------|---------|
| Language | فارسی، English، العربية | English |
| Calendar | Solar Hijri, Gregorian | Solar Hijri |
| Temperature | °C, °F | °C |

- **Units:** values are always stored in one unit (°C, W, kWh), and only the display converts them. A scenario that sets a temperature stores °C.
- **Not settings:** power is always shown as W or kW automatically, times are always 24-hour, and the week starts on the calendar's first day (Saturday for Solar Hijri, Monday for Gregorian).
- **API and screen:** `GET` and `PATCH /v1/me/settings`, plus a real Settings screen. The current settings page is only a placeholder.

## E. Home location and scenarios

### Home time zone

- Every home gets a time zone, e.g. `Asia/Tehran`. It is chosen when the home is created (default Tehran), and owners and admins can change it.
- Every scenario time and date is in the home's time zone, never the phone's. The app shows it plainly, e.g. "15:00 Tehran time".

### The three kinds of scenarios

| Kind | Example | Stored as |
|------|---------|-----------|
| Periodic | every Saturday and Tuesday at 15:00 | weekdays + local time + home time zone |
| One-time | 20 Mordad 1407 at 08:00 | a local date + time (Gregorian inside) + home time zone |
| Themed | "Morning", "Party" | a named set of actions, run by a tap |

- **Actions:** each scenario has a list of actions, e.g. "switch 1 on", "camera recording off". Each action is a normal command, so it has a deadline, is applied only when the ESP32 reports, and appears in the device's history as coming from the scenario.
- **Calendar and daylight saving:**
  - Dates are stored in Gregorian and shown in the user's calendar.
  - Showing a date in Solar Hijri uses the built-in `Intl.DateTimeFormat` with the `persian` calendar (no extra dependency, works offline).
  - Only the other direction, a Solar Hijri date picked by the user → Gregorian, is our own small function, with tests on known dates.
  - Daylight-saving changes are handled by the time zone database (PostgreSQL knows every IANA zone).
- **Where scenarios run:**
  - **Always on the home's hub**, so they keep running when the internet is down (local-first). The hub gets the list from the cloud and reports each run.
  - **Until the real hub exists (Phase 4):** the dev hub simulator (`backend/src/dev/hub-simulator.ts`) is the runner, through the same contract, so the whole path works end to end.
  - There is no scheduler in the cloud and no handover: the one runner of a home is its hub.
- **Missed runs:** if the runner was offline at the time, a periodic run is skipped and marked as missed. It never runs late, because a light switching on hours later is worse than not at all. A one-time run gets a 10-minute grace period.
- **Permissions:** owners and admins create and edit scenarios; members can run themed scenarios.

---

## Order of steps

```
B catalog (pump, camera, setup button, icons) ─► C languages (messages, Arabic) ─► D settings (calendar, units)
   ─► E1 home time zone + Solar Hijri/Gregorian dates ─► E2 scenarios (database, API, runner in the dev hub simulator, screens) ─► exit
A (board lifecycle) is specified once, in section A above, and implemented in Phase 4 with the hub.
```

Each step is its own commit, tested on its own; the usual isolation tests (two homes) extend to scenarios.

## Decisions (approved 2026-10-04)

1. **Board lifecycle (section A):** the button times; pairing needs button + home LAN + an owner/admin confirming; a reset deletes the board and its history from the old home, keeps only an audit entry, and notifies the old home.
2. **Scenario runner:** always the home's hub (works offline); the dev hub simulator stands in until Phase 4.
3. **Missed runs:** periodic runs are skipped and marked missed; one-time runs get a 10-minute grace period.
4. **Calendars:** Solar Hijri and Gregorian only, for every language (no lunar Hijri).
5. **Camera:** on/off and recording on/off in this phase; live video and recordings later with a media service.
6. **Settings defaults:** English (changed from Persian on 2026-10-05), Solar Hijri, °C; times are always 24-hour.
