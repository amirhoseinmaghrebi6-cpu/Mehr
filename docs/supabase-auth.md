# Supabase Authentication Setup

## Environment

Copy `.env.example` to `.env.local` and set the Supabase project URL, its publishable key, and the canonical site URL. The publishable key is designed for browser use; never add a Supabase service-role key to this Next.js application or to any `NEXT_PUBLIC_*` variable.

Add these redirect URLs to Supabase Auth:

- `http://localhost:3000/auth/callback`
- The production origin followed by `/auth/callback`

Enable email confirmation, configure a production email provider, set the minimum password length to 12 characters, and review Supabase Auth rate limits before launch. Consider MFA for organization administrators and staff with elevated access.

## Database

Apply `supabase/migrations/202609260001_auth_and_tenant_rls.sql` through the Supabase CLI or migration workflow. New email-confirmed users receive a profile, a personal organization, and owner membership through a database trigger. Organization and property records are guarded by RLS; users do not receive a global administrator role.

Rooms and devices are still local prototype data scoped by authenticated user ID. They are not yet persisted in Supabase. Before syncing them, add their foreign keys to properties and enable equivalent RLS on every table and storage bucket. Never rely on a client-side property ID or on the hidden state of the UI as authorization.

## Routes and sessions

The application refreshes Supabase auth cookies in middleware and verifies the user again in the protected route-group layout. Authenticated dashboard pages live under `app/(app)/`; login, registration, email callback, password recovery, and password update live under `app/(auth)/`.

Registration uses Supabase email confirmation. Password reset responses are generic to avoid revealing whether an email is registered. The callback only accepts same-site paths. Session cookies are managed by the Supabase SSR client rather than browser local storage.

## Demo accounts

The local sample account is `demo@m2smart.local` / `M2smart-Demo-2026!`. It signs into an isolated mock-data session, not a Supabase user; each demo login receives its own user scope and a four-hour signed, HttpOnly cookie. The demo indicator is visible in the shell.

Do not use this account for real users or put real home data in the demo. Production disables demo access unless `M2SMART_DEMO_ENABLED=true`, `M2SMART_DEMO_PRODUCTION_SANDBOX=true`, and a unique `M2SMART_DEMO_SESSION_SECRET` are explicitly configured. For buyer presentations, use a separate demo tenant/project with fabricated data, limited permissions, and a reset workflow. Never make this account a platform administrator or include a Supabase service-role key.