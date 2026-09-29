# Authentication

M2smart signs users in with a mobile number and a one-time SMS code. A password is optional and can be added after the first sign-in (decision D1). Identity runs on self-hosted [Ory Kratos](https://www.ory.sh/kratos/) inside our own infrastructure. No foreign auth service is involved, so sign-in keeps working on Iran's national internet.

Setup and dev commands are in [infra/README.md](../infra/README.md); the trust model is in [architecture/trust-boundaries.md](architecture/trust-boundaries.md).

## Components

| Piece | Where | Role |
|-------|-------|------|
| Kratos | `infra/dev/kratos/` | Owns identities, SMS codes, passwords and sessions, in its own `kratos` database. |
| Web app (Next.js) | `lib/auth/`, `app/(auth)/` | Runs the sign-in screens. Server actions drive Kratos flows on the server; the browser never talks to Kratos. |
| M2smart API | `backend/src/auth/` | Verifies each session with Kratos (`/sessions/whoami`) and keeps `auth.users` in sync, so RLS (`auth.uid()`) works. |

App code imports only `@/lib/auth` (the `AuthGateway`). The adapters in `lib/auth/adapters/` are private, and ESLint enforces this.

## Journeys

- **Registration:** name and mobile number, then the 6-digit code.
  - Kratos creates the identity, and the identity webhook creates the matching `auth.users` row.
  - A database trigger then creates the profile, a personal organization and owner membership.
  - Registering with a password is refused by a webhook. Nobody can claim a number without the SMS code.
- **Sign-in:** either a mobile number and SMS code, or a mobile number and password (for users who set one).
  - Mobile numbers can be typed as 09…, +98… or 0098…, in Latin, Persian or Arabic digits. They are stored in E.164 (`+989…`).
- **Forgot password:** sign in with an SMS code, then choose a new password at `/update-password`.
  - This page needs a signed-in user.
  - If Kratos asks for a fresh sign-in, the user is signed out and sent back through the SMS code.
- **Sign-out:** ends the Kratos session and clears its cookie.

Error messages are shown in English and Persian. Kratos or the API being unreachable is shown as "try again shortly", never as wrong credentials.

## Sessions

- **Kratos session cookie (`ory_kratos_session`):**
  - HttpOnly, SameSite=Lax, 30 days.
  - Set on the web app's origin. Next.js relays Kratos cookies and forwards only Kratos's own cookies back to Kratos.
- **Next.js server:**
  - Reads the signed-in user from the API's `GET /v1/me`.
  - Proxies `/api/v1/*` to the API for browser code.
  - Never exposes the API's `/internal/*` routes or Kratos itself.
- **API:**
  - Accepts the cookie, `Authorization: Bearer <session token>` or `X-Session-Token` (for native apps).
  - Caches a verified session for 30 seconds, so a revoked session can stay usable on the API for up to 30 seconds.
- **Kratos settings:**
  - SMS codes are valid for 10 minutes.
  - Passwords need at least 12 characters.
  - The `profile` settings method is off, so a phone number cannot be changed without an SMS check.

## SMS delivery

Kratos's courier sends SMS over HTTP.

- **In development:** it posts to the API's `POST /internal/dev/sms`, which logs the code as `DEV SMS (not sent)` instead of sending it.
- **Still to do:**
  - Connect a real Iranian SMS provider.
  - Rate-limit code requests per number and per IP (at the SMS proxy or nginx). Kratos's self-hosted build does not rate-limit code requests itself.

## Demo account

The sample account `demo@m2smart.local` / `M2smart-Demo-2026!` must always keep working.

- **What it is:**
  - It is not a Kratos identity: it signs into an isolated mock-data session.
  - Each demo login gets its own user scope and a four-hour signed, HttpOnly cookie.
  - The login page shows an "Enter the demo" card, and the shell shows a demo indicator.
- **Where it is enabled:**
  - In development it is on unless `M2SMART_DEMO_ENABLED=false`.
  - Production disables it unless all three are configured: `M2SMART_DEMO_ENABLED=true`, `M2SMART_DEMO_PRODUCTION_SANDBOX=true`, and a unique `M2SMART_DEMO_SESSION_SECRET`.
- **Restrictions:**
  - Never use it for real users or real home data.
  - Never give it administrator rights.

## Configuration

Web app (`.env.local`, see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `KRATOS_PUBLIC_URL` | Kratos public API, reached only from the Next.js server |
| `M2SMART_API_INTERNAL_URL` | M2smart API, for `/v1/me` and the `/api/v1/*` proxy |
| `M2SMART_DEMO_*` | Demo account (see above) |

Without `KRATOS_PUBLIC_URL` and `M2SMART_API_INTERNAL_URL`, only the demo account works.

API (`backend/.env.local`, see `backend/.env.example`): the Kratos URL, `KRATOS_WEBHOOK_SECRET` (the same value as in `infra/dev/.env`), and the database settings.

## Database

The migrations in `supabase/migrations/` run unchanged on self-hosted PostgreSQL through `pnpm db:migrate`.

- `infra/postgres/bootstrap.sql` provides the platform objects the migrations expect: the `anon`, `authenticated` and `service_role` roles, `auth.users` and `auth.uid()`.
- The directory keeps its original name so existing migration checksums stay valid.
- Organization and property records are protected by RLS. The API also checks authorization in code, and RLS is the second layer.
