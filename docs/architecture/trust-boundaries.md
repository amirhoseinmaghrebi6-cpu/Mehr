# Trust boundaries

This page defines who may talk to whom in M2smart and what each side must prove. Authentication is described in [../auth.md](../auth.md).

**Standing constraint.** Production runs on servers inside Iran and must keep working when international internet is cut. No channel below may depend on a foreign host at runtime, including fonts, images, SMS, telemetry and package or image registries at deploy time (use mirrors inside Iran). The hub must keep working with no internet at all.

## Components

| Component | Runs where | Holds |
|-----------|------------|-------|
| Browser / mobile app | user device | Kratos session cookie (browser) or session token (native app) |
| Web app (Next.js) | cloud, in Iran | no database credentials, no secrets beyond its own config |
| M2smart API | cloud, in Iran | the only app-level PostgreSQL client; the webhook secret |
| Ory Kratos | cloud, in Iran | identities, credentials, sessions (own `kratos` database) |
| PostgreSQL | cloud, in Iran | app data, protected by RLS |
| MQTT broker | cloud, in Iran | hub connections (Phase 4) |
| Hub | the home's LAN | local broker, cached grants and keys (later phases) |
| ESP32 devices | the home's LAN | per-device credentials for the hub (Phases 6–7) |

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
  - Only the backend (and, later, the hub path) marks them sent or applied, and "applied" requires the ESP32's report.
  - A device accepts at most 20 open commands.
- **Hardware catalog:** pin maps, capability templates and interlocks are backend-only. Users never read or change which GPIO does what.
- **Backend-only work** runs under `withSystemTx` (`service_role`, bypasses RLS). Keep its use rare and easy to find.
- **Kratos → API webhooks** (identity sync, refusing password registration):
  - Accepted only from loopback or private addresses.
  - Must carry the shared `KRATOS_WEBHOOK_SECRET`.

### 2. Hub ↔ cloud (Phase 4)

- The hub connects outbound to the cloud MQTT broker over TLS, with a per-hub credential. The cloud never connects into a home.
- Broker ACLs limit each hub to its own property's topics.
- The cloud sends commands with an expiry; an expired command is never replayed.

### 3. Device ↔ hub (Phases 6–7)

- ESP32 devices talk only to the hub's local broker, with per-device credentials and ACLs. They never talk to the cloud directly.

### 4. Client ↔ hub over the LAN (reserved, not implemented)

Design rules to keep in mind now:

- **Offline grants:**
  - The cloud issues each member short-lived, signed offline grants: user, property, role, allowed actions, expiry and key ID.
  - The hub checks them without internet, using the property's cached public keys.
  - Revocation uses short expiry plus a revocation list the hub syncs.
- **Finding and trusting the hub:**
  - The phone finds the hub by mDNS and connects over TLS.
  - It trusts the hub's certificate by a fingerprint the cloud gave it earlier (pinning), not a public CA.
- **Local commands:**
  - They carry the same envelope as cloud commands: idempotency key, `origin` (`cloud`, `lan`, `automation` or `physical`), principal, and the hub's sequence number.
  - The hub decides LAN commands and syncs them to the cloud afterwards for audit.

Hooks that already exist:
- `Principal.issuer` is `"cloud"` today, so a `"hub"` issuer needs no interface change.
- Role-to-action rules will live as plain data in `packages/contracts`, so the hub can enforce the same rules.

## Demo account

The demo session is not a Kratos identity. It is a signed cookie for an isolated mock-data scope and never reaches real homes or the database. Production keeps it off unless it is explicitly configured as a sandbox (see [../auth.md](../auth.md)).
