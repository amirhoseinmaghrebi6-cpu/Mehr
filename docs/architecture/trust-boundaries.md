# Trust boundaries

This page defines who may talk to whom in M2smart and what each side must prove. Authentication is described in [../auth.md](../auth.md).

**Standing constraint.** Production runs on servers inside Iran and must keep working when international internet is cut. No channel below may depend on a foreign host at runtime, including fonts, images, SMS, telemetry and package or image registries at deploy time (use mirrors inside Iran). Without any internet, a board still obeys its wall switches and keeps its relay states.

## Components

| Component | Runs where | Holds |
|-----------|------------|-------|
| Browser / mobile app | user device | Kratos session cookie (browser) or session token (native app) |
| Web app (Next.js) | cloud, in Iran | no database credentials, no secrets beyond its own config |
| M2smart API | cloud, in Iran | the only app-level PostgreSQL client; the webhook secret |
| Ory Kratos | cloud, in Iran | identities, credentials, sessions (own `kratos` database) |
| PostgreSQL | cloud, in Iran | app data, protected by RLS |
| MQTT broker | cloud, in Iran | one account per board, limited to that board's topics (Phase 4) |
| ESP32 boards | the home's Wi-Fi | their factory secret and, once paired, their broker secret (firmware in Phases 6–7) |

There is no hub (decided 2026-10-04): boards connect straight to the broker. Without internet nothing is controlled from the app; wall switches keep working on the board itself.

## Channels

### 1. Client ↔ cloud (implemented, Phase 2)

- **One origin for the browser:** the browser talks only to the web app. Server actions and server components call Kratos and the API over the internal network.
- **What the browser can reach:**
  - The browser-facing API is only `/api/v1/*`, proxied by the web app.
  - `/internal/*` (webhooks, the dev SMS sink) is never proxied.
  - Kratos is not exposed to the browser at all.
- **Native apps:** they send `Authorization: Bearer <session token>` to the API directly.
- **The API trusts nothing from the client except the session credential:**
  1. It asks Kratos who the session belongs to.
  2. It authorizes in code.
  3. It runs user queries under `withUserTx`, which sets the `authenticated` role and the user's claims with `SET LOCAL`, so RLS enforces tenant isolation as a second layer.
- **Home data** (Phase 3):
  - Every request under `/v1/properties/:id` checks the user's role in that home against the permission table in `packages/contracts/src/permissions.ts`:
    - owner: everything;
    - admin: everything except deleting the home;
    - member: view and control devices.
  - Then it runs under RLS.
  - A home the user does not belong to is always 404, never 403.
  - Composite foreign keys keep every room, board, device and command inside its home.
- **Commands:**
  - Clients can only create pending commands.
  - Their deadline is set by the database (30 s for the network + the hardware's time), not by the client.
  - Only the backend marks them sent or applied, and "applied" requires the ESP32's report.
  - A device accepts at most 20 open commands.
- **Scenarios:**
  - Every member of a home can read its scenarios. Only owners and admins can create or change them, and every member can run a themed one.
  - An action can target only a writable capability of a device in the same home; RLS, composite foreign keys and a trigger enforce this in the database.
  - A run creates ordinary commands under the same rules as above.
  - Only the runner records scheduled runs and missed runs. The runner is the server (the dev simulator stands in until step 4D). Clients can record only their own manual runs.
- **Hardware catalog:** pin maps, capability templates and interlocks are backend-only. Users never read or change which GPIO does what.
- **Backend-only work** runs under `withSystemTx` (`service_role`, bypasses RLS). Keep its use rare and easy to find.
- **Kratos → API webhooks** (identity sync, refusing password registration):
  - Accepted only from loopback or private addresses.
  - Must carry the shared `KRATOS_WEBHOOK_SECRET`.

### 2. Board ↔ cloud (Phase 4)

The contract is [../board-protocol.md](../board-protocol.md).

- **Outbound only:** a board connects out to the cloud MQTT broker over TLS. The cloud never connects into a home.
- **One account per board:** the username is the board's id, the secret is issued at pairing, and broker rules limit the board to its own topics. A board can never read or write another board's messages, in its own home or any other.
- **The API is the only other broker client.** It publishes commands and reads reports; browsers and apps never talk to the broker.
- **Reports are checked like requests:** a value is stored only if it fits a capability that board really has, and a report completes a command only if the command belongs to that same board.
- **A command is "applied" only when the board reports the target value.** A different reported value marks it failed; a refusal marks it rejected.
- **Commands carry how long they are valid;** an expired command is never sent or replayed.

### 3. Pairing and reset (Phase 4)

- **A board joins a home only when all three hold:**
  - someone holds it (setup button, pairing mode);
  - an owner or admin uploads its one-time pairing code in the app;
  - the board proves it is genuine with its factory secret.
- **The registry of manufactured boards and the pending pairings are backend-only.** The server stores only hashes of factory secrets and pairing codes.
- **A pairing code** is made by the board, fresh on every pairing mode, valid once and for 24 hours.
- **A broker secret** is replaced at every pairing; the old one stops working.
- **A factory reset leaves nothing on the server** about the board: no devices, states, commands, audit entry or notification.
- **Accepted risk:** whoever can hold the button owns the board (owning = holding).

### 4. No history

The server keeps only the current state:
- the last reported value per capability;
- the latest result per scenario;
- finished commands for 24 hours;
- one energy total per metered device per day, for one year.

A cleanup job deletes the rest.

## Demo account

The demo session is not a Kratos identity. It is a signed cookie for an isolated mock-data scope and never reaches real homes or the database. Production keeps it off unless it is explicitly configured as a sandbox (see [../auth.md](../auth.md)).
