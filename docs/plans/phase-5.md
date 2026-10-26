# Phase 5 plan: the app for real users

Status: in progress (started 2026-10-26).

**Goal:** everything a real household needs from the web app, apart from the hardware: sharing a home with family, real SMS codes, live updates, and the Security and Activity screens for real homes. None of it depends on the board specifications; firmware stays in Phases 6–7.

## Steps

| Step | What |
|------|------|
| 5A | Home members (done): invitations by mobile number, accepting and declining, roles, removing and leaving; a Members section; the demo shows all of it. |
| 5B | The real SMS provider: FarazSMS / IranPayamak (done): login codes reach real phones (tested 2026-10-26 with the approved pattern). The invitation SMS waits for its pattern to be approved; until then invitations show in the app only. Sending limits come with deployment (Phase 9). |
| 5C | Live updates (done): database notices → API Server-Sent Events → the page re-reads; a board report shows on every open page in well under a second (0.3 s in the browser test). The demo updates live between tabs. |
| 5D | Security, Cameras and Activity for real homes (done): built from the devices' current states plus the last 24 hours of commands; the demo uses the same screens with its sample devices. |

## 5A decisions (2026-10-26)

- People are invited by mobile number. The invited person sees the invitation in the app after signing in (or signing up) with that number; once the SMS provider is in (5B), an SMS will tell them too.
- An owner invites, re-roles and removes admins and members; an admin invites and removes members only. Nobody manages an owner, and an owner cannot leave (they delete the home instead). Anyone else may leave.
- An invitation has no expiry. It stays until it is accepted, declined or cancelled, and is deleted then: nothing about past invitations is kept.
- A member reaches every device of the home and runs scenarios, but changes nothing (as before).
- Owners and admins see every member with their number; a member sees only themself.

Where: `supabase/migrations/202610270001_home_members.sql`, `backend/src/http/members.ts`, `packages/contracts/src/members.ts`, `features/members/members.tsx`. Tests: `backend/test/members.test.ts`, `backend/test/sql/phase5-members.sql`.

## 5B decisions (2026-10-26)

- Provider: FarazSMS, which runs on IranPayamak (`POST https://api.iranpayamak.com/ws/v1/sms/pattern`, header `Api-Key: <key>`, recipients as 09…, pattern line 90008361). Every message is a pre-approved pattern, so it also reaches numbers that blocked advertising. (An earlier draft targeted IPPanel; the account is on IranPayamak.)
- Only the one-time code leaves our servers; the wording is the approved pattern. Kratos hands codes to `POST /internal/kratos/sms` (internal network and the webhook secret only), and a failed send answers 502 so Kratos retries.
- Until the key, the sender and the code pattern are all set, the API only logs messages (and warns at startup).
- An invitation also sends an SMS (best effort: the invitation stands if it fails).
- Patterns to submit in the panel: login `M2smart / کد ورود شما: %code% / این کد را به کسی ندهید.`; invitation `%name% شما را به خانه‌ی «%home%» در M2smart دعوت کرد. برای پذیرفتن، با همین شماره وارد شوید.`
- The API key lives only in `backend/.env.local` (production: the server's environment).

## 5C decisions (2026-10-26)

- Notices carry only the home's id, never data: pages re-read through the normal routes, so access rules stay in one place.
- Database triggers send them (devices, reported states, a board going online or offline, a command's progress), so every writer is covered: board reports, scenarios, the API.
- One stream per open page; it ends every 10 minutes and the browser reconnects, which checks the session and membership again.
- The 15-second refresh became a 60-second fallback.

## 5D decisions (2026-10-26)

- Security is a checklist of what the devices report now (alarm, doors and windows, smoke/gas/water, cameras, boards online); a row that needs attention opens its device.
- Cameras list the camera devices with their on/recording state; live video comes later (a media service), and the demo keeps its sample pictures.
- Activity: the alerts of right now (leak, smoke, gas, alarm, offline board, open door or window, board waiting to be paired), then the last 24 hours of commands with who sent them or which scenario ran them. Nothing new is stored: commands were already kept for a day.
