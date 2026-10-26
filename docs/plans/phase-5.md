# Phase 5 plan: the app for real users

Status: in progress (started 2026-10-26).

**Goal:** everything a real household needs from the web app, apart from the hardware: sharing a home with family, real SMS codes, live updates, and the Security and Activity screens for real homes. None of it depends on the board specifications; firmware stays in Phases 6–7.

## Steps

| Step | What |
|------|------|
| 5A | Home members (done): invitations by mobile number, accepting and declining, roles, removing and leaving; a Members section; the demo shows all of it. |
| 5B | The real SMS provider: Faraz SMS (IPPanel Edge API). Code built (login codes and invitation SMS); waiting for the approved patterns to test live. Sending limits come with deployment (Phase 9). |
| 5C | Live updates in the browser instead of 15-second refreshes. |
| 5D | Security and Activity for real homes (they are sample data in the demo only today). |

## 5A decisions (2026-10-26)

- People are invited by mobile number. The invited person sees the invitation in the app after signing in (or signing up) with that number; once the SMS provider is in (5B), an SMS will tell them too.
- An owner invites, re-roles and removes admins and members; an admin invites and removes members only. Nobody manages an owner, and an owner cannot leave (they delete the home instead). Anyone else may leave.
- An invitation has no expiry. It stays until it is accepted, declined or cancelled, and is deleted then: nothing about past invitations is kept.
- A member reaches every device of the home and runs scenarios, but changes nothing (as before).
- Owners and admins see every member with their number; a member sees only themself.

Where: `supabase/migrations/202610270001_home_members.sql`, `backend/src/http/members.ts`, `packages/contracts/src/members.ts`, `features/members/members.tsx`. Tests: `backend/test/members.test.ts`, `backend/test/sql/phase5-members.sql`.

## 5B decisions (2026-10-26)

- Provider: Faraz SMS, through IPPanel's Edge API (`POST https://edge.ippanel.com/v1/api/send`, header `Authorization: <key>`). Every message is a pre-approved pattern, so it also reaches numbers that blocked advertising.
- Only the one-time code leaves our servers; the wording is the approved pattern. Kratos hands codes to `POST /internal/kratos/sms` (internal network and the webhook secret only), and a failed send answers 502 so Kratos retries.
- An invitation also sends an SMS (best effort: the invitation stands if it fails).
- Patterns to submit in the panel: login `M2smart / کد ورود شما: %code% / این کد را به کسی ندهید.`; invitation `%name% شما را به خانه‌ی «%home%» در M2smart دعوت کرد. برای پذیرفتن، با همین شماره وارد شوید.`
- The API key lives only in `backend/.env.local` (production: the server's environment).
