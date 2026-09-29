# M2smart

M2smart is a smart-home platform: a Next.js web app, a Fastify API, self-hosted PostgreSQL, Ory Kratos for sign-in, and MQTT for hubs. Everything runs on our own servers inside Iran; the app makes no requests to foreign hosts at runtime, so it keeps working on Iran's national internet.

## Run locally

**Prerequisites:**
- Node.js 20 or newer
- pnpm 10
- Docker with Compose v2

No Supabase CLI or cloud account is needed. Behind a restricted network, see the registry-mirror notes in [infra/README.md](infra/README.md).

1. **Install and configure.** Copy the three env files and fill in the values:

   ```bash
   pnpm install
   cp infra/dev/.env.example infra/dev/.env        # database and Kratos secrets
   cp backend/.env.example backend/.env.local      # API: DATABASE_ADMIN_URL, KRATOS_WEBHOOK_SECRET, ...
   cp .env.example .env.local                      # web app: Kratos and API URLs, demo account
   ```

   - `KRATOS_WEBHOOK_SECRET` must be the same in `infra/dev/.env` and `backend/.env.local`.
   - `DATABASE_ADMIN_URL` in `backend/.env.local` uses the `POSTGRES_PASSWORD` from `infra/dev/.env`.
   - The env files are gitignored; never commit them.

2. **Start the database, broker and Kratos**, then create the schema, run the RLS tests and load sample data:

   ```bash
   pnpm infra:up         # PostgreSQL, Mosquitto and Kratos, bound to 127.0.0.1
   pnpm db:migrate       # applies infra/postgres/bootstrap.sql and supabase/migrations/*.sql
   pnpm db:test          # RLS test suite
   pnpm db:seed          # dev user, sample property, hub and devices
   ```

3. **Start the API and the web app**, in two terminals:

   ```bash
   pnpm api:dev          # API on http://127.0.0.1:4000
   pnpm dev              # web app on http://localhost:3000
   ```

4. **Sign in.** Open http://localhost:3000 and use either account:
   - **Your own account:** create one with your name and a mobile number. The SMS code is not sent in development; copy it from the `DEV SMS (not sent)` line in the `pnpm api:dev` terminal.
   - **Demo account:** use the "Enter the demo" card on the login page (`demo@m2smart.local` / `M2smart-Demo-2026!`, sample data only).

**Checks:**

```bash
pnpm typecheck && pnpm lint && pnpm build
pnpm --filter @m2smart/api typecheck && pnpm --filter @m2smart/api lint && pnpm --filter @m2smart/api test
```

`pnpm --filter @m2smart/api test` needs the dev stack running and the database migrated.

## Repository layout

| Path | What it holds |
|------|---------------|
| `app/` | Route composition, document metadata, the PWA manifest. Also the self-hosted fonts (`app/fonts`). |
| `components/` | Application shell and shared UI primitives. |
| `features/` | Domain-specific experiences and presentation. |
| `services/` | Replaceable boundaries for API and realtime adapters. The app still uses local mock data. |
| `lib/auth/` | The `AuthGateway` (Kratos and the demo account). App code imports only `@/lib/auth`. |
| `backend/` | The M2smart API (`@m2smart/api`): Fastify, `pg`, the migration runner and the seed. |
| `packages/contracts/` | Request and response schemas shared by the API and the web app. |
| `supabase/migrations/` | SQL migrations. They run on self-hosted PostgreSQL; the directory keeps its original name so migration checksums stay valid. |
| `infra/` | The dev stack (Docker Compose), PostgreSQL bootstrap and Kratos config. |
| `public/images/` | Self-hosted images. |

## Documentation

| Document | Covers |
|----------|--------|
| [docs/auth.md](docs/auth.md) | Sign-in by SMS code and optional password, sessions, the demo account. |
| [docs/architecture/trust-boundaries.md](docs/architecture/trust-boundaries.md) | Who talks to whom, including the future hub and LAN channels. |
| [docs/product-architecture.md](docs/product-architecture.md) | Product map, routes, state boundaries, responsive design. |
| [docs/assets.md](docs/assets.md) | Fonts and images, with sources and licences. |
| [infra/README.md](infra/README.md) | The local stack, ports, registry mirrors inside Iran. |
| [docs/plans/phase-2.md](docs/plans/phase-2.md) | The Phase 2 plan and its decisions. |

The browser never receives database, broker or Kratos admin credentials. Authentication, permissions and device authorization are enforced by the API.
