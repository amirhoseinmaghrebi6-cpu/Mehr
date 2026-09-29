# Phase 2 plan: self-hosted foundation

Status: approved 2026-09-29. Recovered verbatim from the planning session; not started yet. Next step: Phase 2A.

**Findings from the code that shape the plan:**
- **Phone-only users would break sign-up.** `handle_new_auth_user()` in the existing auth migration derives the account name from `email`. For a user with no email, the name comes out null and the insert into `organizations.name` (`not null`) fails. That needs a new migration (step 2B).
- **Type-checking would pull in the new backend.** The root `tsconfig.json` includes `**/*.ts`, and `eslint .` lints everything with the Next.js config. Adding `backend/` as its own package means excluding it from both.
- **No monorepo packages exist yet.** `pnpm-workspace.yaml` only has `allowBuilds`.
- **Port clashes are likely.** The unrelated `openremote-*` stack runs on this machine, so dev services should use non-default ports bound to 127.0.0.1.

## Order of steps

```
2A infra ─► 2B database ─► 2C API skeleton ─► 2D-2..2D-4 Kratos + API sessions ─► 2E frontend switch ─► 2G exit
                              2D-1 (auth port refactor, no behaviour change) can start any time after 2A
                              2F (fonts/images) can be done independently at any point
```

Each step should be its own commit or PR, so each can be checked on its own.

---

## Phase 2A: local infrastructure foundation

- **Goal:** one command brings up the self-hosted dev dependencies (PostgreSQL and Mosquitto), replacing `supabase start` for day-to-day work.
- **Files:**
  - `infra/dev/compose.yaml` (project name `m2smart-dev`)
  - `infra/dev/mosquitto/mosquitto.conf`
  - `infra/dev/.env.example`
  - `infra/README.md`
  - root `package.json` scripts: `infra:up`, `infra:down`, `infra:reset`
- **Dependencies:** no npm packages. Docker images pinned by version (and ideally digest): `postgres:17-alpine` and `eclipse-mosquitto:2.0.x`. The README documents how to point Docker at a registry mirror inside Iran.
- **Database changes:** none. This step only creates an empty cluster.
- **Checks:**
  - `docker compose -f infra/dev/compose.yaml config`
  - `pnpm infra:up`, which uses `up -d --wait` and must reach healthy
  - `docker compose exec postgres pg_isready`
  - A Mosquitto round-trip: `mosquitto_sub` on a test topic plus `mosquitto_pub` inside the container
  - `pnpm infra:reset`, run twice
  - `docker ps` shows only `m2smart-dev-*` containers were added
  - `pnpm typecheck`, `pnpm lint` and `pnpm build` still pass
- **Acceptance:**
  - Starts on a clean machine with no Supabase CLI.
  - Ports bound to `127.0.0.1` only, on non-default ports (e.g. 55432 and 18830).
  - Healthchecks defined.
  - Tearing down removes only `m2smart-dev` resources; openremote is untouched.
  - No secrets committed; dev passwords come from an ignored `.env`.
- **Not yet:** broker authentication or ACLs, TLS, topics, Kratos, the API container, nginx, production compose files, a Dockerfile for any app.

## Phase 2B: database portability and bootstrap

- **Goal:** the existing migrations run unchanged on self-hosted Postgres, through our own migration runner, with the Phase 1 RLS suite automated.
- **Files:**
  - `pnpm-workspace.yaml` gains `packages: [backend]`
  - `backend/package.json`, `backend/tsconfig.json`
  - root `tsconfig.json` and ESLint config exclude `backend/`
  - `infra/postgres/bootstrap.sql`
  - `backend/src/db/migrate.ts`
  - `backend/scripts/seed-dev.ts`, which uses plain `pg` in place of `supabase-js`
  - `backend/test/sql/rls-phase1.sql`: the verified 57-check suite from the earlier session, with the corrected `22023` expectation
  - `backend/test/sql/signup-trigger.sql`
  - new file `supabase/migrations/20261001xxxx_signup_without_email.sql`
- **Dependencies:** `pg`, `@types/pg` (backend only). `tsx` is already present.
- **Database changes:**
  - **`bootstrap.sql` (platform-level, idempotent, run as superuser, not an app migration):**
    - roles `anon`, `authenticated` and `service_role` (no login)
    - login role `m2_api`, a member of `authenticated` and `service_role`, without superuser or bypass-RLS rights
    - login role `m2_migrator`, which owns the app objects
    - schema `auth` and table `auth.users (id uuid pk, email text unique null, phone text unique null, raw_user_meta_data jsonb, created_at, updated_at)`, using Supabase's column names
    - `auth.uid()` reading `request.jwt.claims ->> 'sub'`, the same setting Supabase uses
    - Supabase-equivalent default grants
    - Every object is guarded by "if not exists", so it does nothing on a Supabase database.
  - **New migration:** `create or replace function public.handle_new_auth_user()` so that when there is no email, the name falls back to the phone number or a neutral default. The existing migration files are not edited.
  - **Runner:** applies the bootstrap first, then `supabase/migrations/*.sql` in order, one transaction per file. It records the filename and SHA-256 in `m2_platform.schema_migrations`, and refuses to continue if an already-applied file has changed.
- **Checks:**
  - `pnpm db:migrate` twice (the second run is a no-op)
  - `pnpm db:test`: RLS suite plus sign-up trigger tests, including a phone-only user
  - `pnpm db:seed` twice, then check counts: 1 property, 1 hub, 8 devices, 12 capabilities, 12 states
  - Change one byte of an applied migration; the runner must refuse
  - `pnpm infra:reset && pnpm db:migrate` from scratch
- **Acceptance:**
  - All 57 existing checks pass on Postgres 17 through the runner.
  - A phone-only user gets a profile, an organization and an owner membership.
  - Existing migration files are byte-identical to today.
  - The `supabase_realtime` publication still gets created and is harmless.
- **Not yet:** Kratos database, new domain tables, removing the old Supabase seed (that happens in 2G), PgBouncer, replication, backups.

## Phase 2C: API skeleton

- **Goal:** a minimal, production-shaped M2smart API process that owns the only app connection to Postgres, with proven per-user RLS handling.
- **Files:**
  - `backend/src/{server.ts, config.ts, db/pool.ts, db/tx.ts, http/health.ts}`
  - `backend/test/*.test.ts`
  - `packages/contracts/`: a tiny TypeScript-only package for request/response types shared with the frontend, starting with `HealthResponse`
- **Dependencies:** `fastify` (v5, includes pino logging), `zod`; dev: `vitest`.
- **Database changes:** none.
- **Key pieces:**
  - `withUserTx(principal, fn)` opens a transaction, runs `set local role authenticated` and `set_config('request.jwt.claims', …, true)`, then runs the work, so RLS applies.
  - `withSystemTx(fn)` does the same with `set local role service_role`.
  - Config is validated with zod at startup, and the process exits with a clear message if anything is missing.
  - Graceful shutdown drains the database pool.
- **Checks:**
  - `pnpm --filter @m2smart/api typecheck | lint | test | build`
  - `curl :4000/healthz` returns 200
  - `/readyz` returns 200, then 503 after `docker compose stop postgres`
  - The integration test uses `withUserTx` as user A and confirms that none of property B's rows are visible and that writes to `device_states` are denied.
- **Acceptance:**
  - The API connects as `m2_api`.
  - A test confirms `m2_api` cannot bypass RLS outside `withSystemTx`.
  - Logs are structured and never contain secrets or claims.
- **Not yet:** any authentication, domain endpoints, MQTT client, WebSocket, rate limiting, Dockerfile.

## Phase 2D: authentication abstraction and Kratos

**2D-1: auth port refactor, no behaviour change**
- **Goal:** all auth calls in the frontend go through an `AuthGateway` interface. Today's behaviour is kept, using two adapters: `supabase` and `demo`.
- **Files:**
  - `lib/auth/{gateway.ts, types.ts, index.ts}`
  - `lib/auth/adapters/{supabase.ts, demo.ts}`
  - rewire `middleware.ts`, `app/(auth)/actions.ts`, `app/(app)/actions.ts`, `app/(app)/layout.tsx`
  - `lib/supabase/*` becomes internal to the Supabase adapter
- **Dependencies:** none.
- **Database changes:** none.
- **Interface:**
  - Flow-oriented, because Kratos flows have several steps: `getCurrentPrincipal()`, `startLogin` / `submitLogin`, `startRegistration` / `submitRegistration`, `startRecovery` / `submitRecovery`, `signOut()`.
  - `Principal` = `{ userId, sessionId, displayName, authMethod, issuer: "cloud" }`.
- **Checks:**
  - `typecheck`, `lint`, `build`
  - The ESLint `no-restricted-imports` rule forbids importing `@supabase/*` outside `lib/auth/adapters/`
  - Manual smoke test of login, register, reset and logout with the demo and Supabase adapters
- **Acceptance:** identical user-visible behaviour. `grep` finds `@supabase` only in the adapter.
- **Not yet:** Kratos, UI changes.

**2D-2: Kratos spike (timeboxed, throwaway branch)**
- **Goal:** confirm the choice made in answer A before committing to it. Each item below must work on the self-hosted open-source Kratos:
  1. Passwordless login and registration by SMS code using a phone number.
  2. Courier sends SMS through a generic HTTP channel.
  3. UUID identity IDs.
  4. A registration webhook that calls our API.
  5. Server-side flows from Next.js, with correct cookies and CSRF.
  6. Session check (`/sessions/whoami`) and logout.
  7. An optional password method.
- **Result:** a short written report. If items 1–5 don't work without patching Kratos, switch to the fallback (Better Auth; see A) and redo 2D-3 for it.

**2D-3: Kratos in the dev stack**
- **Files:**
  - `infra/dev/kratos/{kratos.yml, identity.schema.json, courier-sms.jsonnet}`
  - a `kratos` service in `compose.yaml`
  - `kratos` database and role added to `bootstrap.sql`
- **Dependencies:** the `oryd/kratos` image, pinned.
- **Database changes:** a separate `kratos` database in the same cluster, with Kratos managing its own migrations. No changes to the app database.
- **Identity and delivery:**
  - The identity schema makes the phone number the required identifier; email is optional.
  - SMS in dev goes to an API route (`POST /internal/dev/sms`) that only logs the code, and is disabled unless `NODE_ENV=development`.
- **Checks:**
  - `pnpm infra:up` brings Kratos up healthy
  - `kratos migrate sql` completes
  - A registration flow run with `curl` delivers a code to the dev SMS route
- **Acceptance:**
  - Kratos is reachable only on 127.0.0.1.
  - The admin API is never exposed.
  - Secrets (cookie and cipher keys) come from `.env`.

**2D-4: API session verification and identity sync**
- **Files:**
  - `backend/src/auth/{session-verifier.ts, kratos-verifier.ts, identity-webhook.ts}`
  - `backend/src/http/me.ts`
  - `packages/contracts` gains `MeResponse`
- **Dependencies:** `@ory/client`, or plain `fetch` (preferred: one fewer dependency).
- **Database changes:** none. The webhook upserts `auth.users`, and the existing trigger creates the profile and organization.
- **Behaviour:**
  - `SessionVerifier` interface: takes the forwarded session cookie or token and returns a `Principal` or null. Results are cached for about 30 seconds, keyed by a hash of the token.
  - `/v1/me` returns the profile and organization memberships. It creates the user row if the webhook was missed.
  - The webhook requires a shared secret, only accepts calls from the internal network, and is idempotent.
- **Checks:**
  - `vitest`: invalid, expired and valid sessions; replayed webhook; missed webhook recovered by `/v1/me`
  - Manual end to end: register by phone, get the code from the dev route, `curl /v1/me` with the cookie shows the user and their personal organization
- **Acceptance:** the API never sees passwords or codes. `/v1/me` runs through `withUserTx`, so RLS applies.
- **Not yet across 2D:** MFA, social login, per-hub or device credentials, mobile token flows, admin UI, production SMS provider (only the interface and dev sink exist).

## Phase 2E: frontend auth migration

- **Goal:** the web app authenticates against Kratos through `AuthGateway`, and gets user data only from the M2smart API.
- **Files:**
  - `lib/auth/adapters/kratos.ts`
  - `components/auth/auth-screen.tsx`: a phone field and an OTP step, with password fields optional depending on decision D1
  - `app/(auth)/*` pages and actions
  - `app/(auth)/auth/callback/route.ts`: removed or reduced to a redirect
  - `app/(app)/layout.tsx`, which calls `/v1/me` server-side
  - `middleware.ts`
  - `next.config.ts`: dev rewrites so `/api/*` goes to the API and `/.ory/*` to Kratos public, keeping everything same-origin with no nginx in dev
  - `lib/i18n.ts`: new strings (English and Persian)
  - `.env.example` gains `M2SMART_AUTH_PROVIDER`, `M2SMART_API_INTERNAL_URL` and `KRATOS_PUBLIC_URL`
- **Dependencies:** none. A phone-number library only if simple validation proves insufficient.
- **Database changes:** none.
- **Checks:**
  - `typecheck`, `lint`, `build`
  - Manual pass on desktop and mobile widths, in both English and Persian (RTL): register → OTP → dashboard; logout; login; recovery; expired code; wrong code; code rate limiting (Kratos may rely on the proxy for this, so record the gap for Phase 9)
  - The browser network tab shows no requests to `*.supabase.co`
- **Acceptance:**
  - With `M2SMART_AUTH_PROVIDER=kratos`, the app works with no Supabase variables set.
  - The demo adapter still works and stays isolated.
  - Session cookies are HttpOnly and SameSite=Lax (Secure in production).
  - The `next` redirect guard is kept.
- **Not yet:** replacing the device mock (Phase 3), realtime, native mobile flows, LAN access.

## Phase 2F: self-hosted assets

- **Goal:** the frontend makes no runtime requests to foreign hosts, and the build doesn't need Google Fonts.
- **Files:**
  - `app/fonts/*.woff2` plus OFL licence files for DM Sans and Manrope, loaded through `next/font/local` in `app/layout.tsx`
  - `app/globals.css` (remove the `@import` and the Unsplash `url(...)`s)
  - `public/images/*`
  - `components/workspace-dialogs.tsx`, `services/mock-home-service.ts`
  - `docs/assets.md` listing each image's source and licence
- **Dependencies:** none. `next/font/local` is built into Next.js.
- **Database changes:** none.
- **Checks:**
  - `grep -rnE "https?://" app components features services lib` shows no external asset hosts
  - `pnpm build`
  - `pnpm start` with external access blocked shows zero failed or external requests and no visual regressions (compare screenshots)
- **Acceptance:**
  - Fonts, including Persian text fallbacks, render as before.
  - Images are optimized (WebP/AVIF) and a reasonable size.
- **Not yet:** user photo uploads and object storage, a CDN, Content-Security-Policy headers (worth adding in Phase 9).

## Phase 2G: Phase 2 exit

- **Goal:** the Supabase dual path is closed, docs are updated, and the whole flow is checked end to end on a clean checkout.
- **Files:**
  - delete the Supabase adapter, `lib/supabase/`, `backend/scripts/seed-phase1.ts`, and the `@supabase/*` dependencies (subject to decision D2)
  - `docs/supabase-auth.md` becomes `docs/auth.md`
  - update `docs/product-architecture.md`
  - new `docs/architecture/trust-boundaries.md` (see D)
  - `README.md`: local setup
- **Checks:** on a fresh clone:
  - `pnpm install` → `infra:up` → `db:migrate` → `db:test` → `db:seed`
  - start the API and the web app
  - register by phone and see the dashboard
  - `pnpm typecheck && pnpm lint && pnpm build && pnpm --filter @m2smart/api test`
  - `git grep -i supabase` returns only `supabase/migrations` (the directory name) and history docs
- **Acceptance:** no foreign service is needed to run the whole stack locally, and `git diff` contains no secrets.
- **Not yet:** anything from Phase 3 onwards.

---

## A. Which self-hosted authentication solution?

**Recommendation: Ory Kratos** (Apache-2.0, Go, one stateless service using its own Postgres database), placed behind `AuthGateway` in the frontend and `SessionVerifier` in the API. **Fallback: Better Auth**, if the 2D-2 spike fails.

**Why Kratos:**
- It has been in production use since around 2020 and is built only for identity. It handles registration, login, recovery, verification, sessions, CSRF and anti-enumeration without us writing security code. That matters when sessions can unlock doors.
- It supports passwordless SMS codes, and its courier sends SMS through a configurable HTTP template. That allows an Iranian SMS provider with no custom code. The spike must confirm this on the self-hosted open-source build.
- It is headless, so our Next.js UI keeps its RTL and design system.
- Identity IDs are UUIDs, so existing `auth.users` foreign keys and `auth.uid()` keep working through the identity-sync webhook. The existing sign-up trigger is reused.
- Later it can turn sessions into signed JWTs, which is useful for the offline hub tokens in D.
- It is one justified service we don't write ourselves, not a microservice split.

**Alternatives rejected:**

| Option | Why not |
|---|---|
| Keycloak | Heavy JVM service. SMS OTP needs third-party extensions. Theming fights our design system. |
| Zitadel / Authentik | Full identity platforms; more than we need. |
| Self-hosted GoTrue (Supabase Auth) | Least migration effort, but it ties our identity model to Supabase's schema and conventions, and running it standalone is poorly documented. |
| Better Auth | Good TypeScript fit and runs inside the API (no extra service), but it's younger and faster-moving, and its auth code runs inside our API process. It's the right fallback, not the first choice. |
| Auth.js | Weak support for credentials and phone login. |
| Custom build | Ruled out by your constraint 7. |

**Known gaps to plan for:** Kratos's self-hosted build relies on the reverse proxy for rate limiting, so code-request limits must be added in nginx (Phase 9). Code limits should be tested in 2E.

## B. What happens to the current Supabase-specific RLS policies?

**Keep them as they are, and adapt what sits underneath them. Don't replace them.**
- The policies depend only on `auth.uid()`, three roles and our own helper functions. The 2B bootstrap provides all of these on vanilla Postgres, using the same settings as Supabase, so the policies behave identically on both. This was proven last session.
- In the new design they are a second layer of protection. The API checks authorization in code first, and then runs user-scoped queries under `withUserTx`, so RLS still blocks cross-tenant access if the API has a bug.
- Backend jobs such as MQTT ingest use `service_role` inside `withSystemTx`, which is a clear, searchable privilege boundary.
- **One caveat:** RLS protects only if the API never uses a role that can bypass it, and always sets claims with `set local` inside a transaction. That matters once a connection pooler (PgBouncer in transaction mode) is added. 2C tests this.
- Renaming `auth.uid()` to something like `app.current_user_id()` is cosmetic, and not worth a migration now.

## C. Should the backend access PostgreSQL directly while the frontend accesses only the backend?

**Yes.**
- The M2smart API is the only app-level Postgres client. Kratos uses its own database, and the migration runner and seed run only at deploy time.
- The browser talks only to the web app and the API, all on one origin through nginx:
  - `/` → Next.js
  - `/api/*` → API
  - `/.ory/*` → only Kratos's public self-service endpoints
- The Next.js server also has no database credentials. Server components call the API over the internal network and forward the session cookie.
- There is no PostgREST or direct database-over-HTTP access, so all authorization lives in one auditable place. The frontend's `HomeGateway` and `RealtimeClient` adapters target only API endpoints, which is what keeps Postgres, the MQTT broker or Kratos replaceable.

## D. How should the future LAN/offline hub authentication be represented now?

As documentation and data-model rules, not code. `docs/architecture/trust-boundaries.md` (2G) would define four separate trust channels:

1. **Client ↔ cloud:** Kratos session, then the API authorizes.
2. **Hub ↔ cloud:** a per-hub credential over MQTT/TLS, with the hub connecting outbound. Phase 4.
3. **Device ↔ hub:** local broker with per-device credentials. Phases 6–7.
4. **Client ↔ hub over the LAN:** reserved; not implemented.

**Rules for channel 4, to design against now:**
- The cloud issues each member short-lived, signed **offline grants** that the hub can check without the internet. A grant carries user, property, role, allowed actions, expiry and key ID.
- The phone caches its grants. The hub caches the property's public keys. Revocation works through short expiry plus a revocation list the hub syncs.
- The phone finds the hub by mDNS and connects over TLS. It trusts the hub's certificate by a fingerprint the cloud gave it earlier (pinning), not a public CA.
- Local commands carry the same envelope as cloud commands: idempotency key, `origin` (`cloud`, `lan`, `automation` or `physical`), principal, and the hub's sequence number. The hub syncs them to the cloud afterwards for audit.
- Commands issued in the cloud expire and are never replayed. Commands issued on the LAN are decided by the hub.

**Small hooks worth adding in Phase 2:**
- `Principal.issuer` is `"cloud"` today, so a future `"hub"` issuer needs no interface change.
- The role → allowed-actions table should be written as plain data in `packages/contracts` (in Phase 3), so the hub can later enforce the same rules.
- No database columns yet. `device_commands.origin` and the hub sequence columns come in Phase 4/6 migrations.

## E. Mosquitto or EMQX for Phase 2 development?

**Mosquitto.**
- Phase 2 only needs a broker that starts and passes a health check; nothing publishes yet.
- Mosquitto is tiny, one pinned image (easy to mirror inside Iran), starts in under a second, and is simple to configure.
- It is also the broker that will run on the hub, so the team learns one tool.
- Its dynamic-security plugin covers per-hub credentials and ACLs for Phase 4.

**The production decision stays open:**
- The API will talk to the broker only through a thin `MessageBus` interface with a standard MQTT client, so switching to EMQX is a configuration change.
- Choose between Mosquitto and EMQX before Phase 9, based on a load and failover test at the expected hub count, and on EMQX's licence at that time: recent EMQX releases changed their licensing, so check the terms before depending on it.
- The main reasons to move to EMQX would be clustering, high availability and database-backed auth at scale.

---

**Decisions needed before 2D/2E:**
- **D1 login methods:** SMS code only, or SMS code plus an optional password? **Decided 2026-09-29: SMS code plus an optional password.**
- **D2 Supabase adapter:** delete it in 2G (my recommendation), or keep it longer for dev?
