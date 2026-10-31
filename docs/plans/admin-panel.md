# The operator's panel

Status: done (2026-11-01).

**Goal:** a page for the people who run M2smart: how many users, homes and boards there are, whether the services work, and blocking or deleting an account when needed.

## Decisions (2026-11-01)

- **Who:** the mobile numbers in `PLATFORM_ADMIN_PHONES` (the API's environment; comma-separated, any usual form). They sign in as usual. The app shows them a link to `/admin`; for everyone else `/admin` is a 404 and `/v1/admin/*` answers 403. Changing the list means restarting the API.
- **What it shows:** counts (people, blocked, homes, boards, boards online, commands in the last 24 hours) and whether the database, the board connection, SMS and account control work. People are listed with name, number, joining date and how many homes they own or belong to. Boards are listed with model, hardware id, firmware, online state and their owner. Nothing from inside a home is shown: no home, room, device or scenario names, no states and no commands.
- **Block and unblock:** Kratos sets the identity to inactive and ends its sessions, so the person is signed out at once and cannot sign in. The API also refuses every request of a blocked user, and codes that Kratos still asks to send to a blocked number are dropped, so they cost nothing. Unblocking reverses all of it.
- **Delete:** the Kratos identity first, then every home the person owns with everything in it, their own organization, and the user. Their boards lose their broker accounts and can be paired again. Homes they only belonged to stay and lose them as a member. Nothing about the deleted account is kept.
- An operator is never blocked or deleted from the panel, including by themself.
- The demo has the panel too, for showing it to customers (decided 2026-11-01). It runs over sample people and boards kept in the browser (`services/demo-admin.ts`), marked DEMO. Blocking, unblocking and deleting work there and persist, but nothing reaches the API and no real account is touched.

Where:
- `supabase/migrations/202611010001_platform_admin.sql` (the `platform_*` functions, run as `service_role` only)
- `backend/src/http/admin.ts`
- `backend/src/auth/kratos-admin.ts`
- `packages/contracts/src/admin.ts`
- `features/admin/admin-panel.tsx`
- `app/(app)/admin/page.tsx` (inside the app's frame: the same menus, bottom bar, language and saved settings)
- `services/demo-admin.ts` (the demo's samples)

The Kratos admin API is reached through `KRATOS_ADMIN_URL`: inside the compose network in production, and on `127.0.0.1:4434` in development.

Tests:
- `backend/test/admin.test.ts`
- a browser test, which signs a customer up, blocks, unblocks and deletes them, and checks Persian and a phone width;
- a demo browser test, which checks the sample counts, blocking, deleting with the person's boards, a reload, Persian names, a phone width, and that no request reaches `/api/v1/admin`.
