# Security audit, phase 1 (2026-11-01)

Scope: the API (`backend/`), the web app (Next.js), Kratos settings, nginx, the MQTT broker set-up, the database's access rules and the board firmware. Done by reading every route and the code it calls, plus `pnpm audit`, with fixes tested. There is no server yet, so nothing was tested on one.

The reviewer also wrote most of this code, so this audit is not independent; an outside review before launch is still worth having.

Status: **PASS** = checked by a test that ran; **NOT TESTED** = done or reviewed, no test ran; **OPEN** = found, not fixed yet; **BLOCKED** = needs the real server.

## Fixed

| # | Priority | Finding | Fix | Status |
|---|----------|---------|-----|--------|
| A1 | P0 | Next.js 15.5.26 had a critical unauthenticated remote code execution in its image optimizer, plus a denial of service through server actions and cache poisoning. Further: postcss, sharp, source-map-js (through Next), zod, fastify, fast-uri, ip-address. | Next 15.5.28, zod 4.6.7, fastify 5.12.7, the rest updated; Next's postcss forced to ^8.5.32 (`pnpm.overrides`). The image optimizer is off (`images.unoptimized`): the app does not use it. | PASS: `pnpm audit --prod` finds nothing; the optimizer answers 404; build, typecheck, lint and all tests pass. |
| A2 | P1 | SMS cost: anyone can ask for codes. The limits were per number (5 an hour) and per address (nginx, 10 a minute); many addresses × many numbers had no ceiling. | `SMS_HOURLY_LIMIT` (default 300): a ceiling on all messages an hour. Past it nothing is sent, and an error is logged. | PASS (`sms.test.ts`) |
| A3 | P1 | Invitations sent an SMS each. Invite, cancel and invite again would send texts to any numbers. | At most 10 invitation texts per person an hour. Past that the invitation is still made, without a text. | PASS (`members.test.ts`) |
| A4 | P1 | Memory: the "N an hour" counters were maps that never shrank. The board claim route takes made-up board ids from anyone, so a script could fill the API's memory. | `RecentCounter`: old entries are swept, and there is a ceiling on keys (the oldest go first). Used by board claims, login codes, phone change and invitations. | PASS (`recent.test.ts`) |
| A5 | P2 | One user could hold any number of live-update streams open. | At most 20 per user (429 past that). | PASS (`events.test.ts`) |
| A6 | P2 | Someone who pulls the broker secret out of their own board could flood the database through its report topic. | The API handles at most 20 messages a second per board and drops the rest. | NOT TESTED |
| A8 | P1 | Firmware images were not signed. Whoever controlled an operator account, the server or the broker could put their own firmware on every board, permanently. | **Fixed 2026-11-03.** `firmware/sign.mjs`: an ECDSA P-256 key, encrypted with a passphrase and kept offline. The admin panel takes only the signed `.m2fw`; the server checks it, and the board checks the signature again with the public key built into its firmware before installing. | PASS: API tests refuse unsigned, foreign-key and tampered files. A real t2 image signed by the tool passes mbedTLS's check, the board's own code path run on a PC, and a changed byte is refused. On a real board: NOT TESTED. |
| A7 | P2 | Open redirect: after sign-in, `next=/\evil.com` sent the browser to another site. | Only a same-origin path is accepted (`lib/safe-next.ts`). | PASS (browser test: four attacks stay on the site; a normal link still works) |

Earlier on the same day the firmware also got the protocol's duplicate-command and reconnect-delay rules (commit f588644). It had been reconnecting every 5 s for good, even when refused.

## Open: decisions before launch

| # | Priority | Finding | Recommendation |
|---|----------|---------|----------------|
| B2 | P1 | Operator accounts have one factor: an SMS code, or a password. A stolen SIM gives the admin panel: blocking and deleting users, and firmware for every board. | Two-factor sign-in (TOTP, which Kratos supports) for operators. Together with B1 this closes the worst case. |
| B3 | P1 | Scale: the broker keeps every board's account and role in one JSON file (Mosquitto dynamic security) and rewrites all of it on every pairing. With hundreds of thousands of boards this becomes slow. | Measure it in phase 2 (load test). If it is too slow, move broker authentication to the database (an auth plugin) or to a broker that does this natively. |
| B4 | P2 | Password sign-in has no per-account lockout, only nginx's limit per address. | Accepted for now (12-character minimum). Revisit with B2. |
| B5 | P3 | A board's setup Wi-Fi is open for the 5 minutes after someone holds its key. Someone nearby could read the Wi-Fi password sent to it, or change a paired board's Wi-Fi. | Accepted: it needs physical access to the key and a 5-minute window. Closing it would need a password printed on each board. |
| B6 | P3 | A session revoked in Kratos keeps working for up to 30 s (the API's cache). | Accepted. |
| B7 | — | Rate limits live in the API's memory: they hold while one API process runs. | Move them to the database before running several API copies. |

## Reviewed, no problem found

| Area | What was checked | Status |
|------|------------------|--------|
| Home isolation | Every `/v1/properties/:id/*` route checks the user's role in code and then runs as the user under row-level security. A home someone does not belong to answers 404. | PASS (API and SQL tests across two tenants) |
| Database functions | Every `security definer` function sets `search_path`. The operator functions are revoked from users and run only as `service_role`. | NOT TESTED (read) |
| Internal routes | `/internal/*` is not proxied (only `/api/v1/*` is). Kratos's webhooks also need the shared secret, compared in constant time. | PASS (existing webhook tests) |
| Boards on the broker | Each board may publish only to its own topics. The API accepts a board's reports only for that board's own channels, and command results only for its own commands. | PASS (existing broker and board tests) |
| Pairing | Codes have about 60 random bits, last 10 minutes and only the hash is stored. A claim needs the factory secret (only the hash is stored), and a board gets 5 wrong tries an hour. | PASS (existing tests) |
| Firmware download | Only an active release, by id. Boards check the image's SHA-256 and use HTTPS with the public CA list. | PASS (existing tests) |
| XSS | No `dangerouslySetInnerHTML` or `innerHTML` with user data. The board's setup page writes network names as text. A strict CSP, HSTS, `frame-ancestors 'none'` and `nosniff` are in place. | NOT TESTED (read) |
| Secrets in logs | Cookies, tokens and webhook secrets are redacted from request logs. Phone numbers are shortened in the SMS log. | NOT TESTED (read) |

## Blocked until the server exists

- **Real TLS on the domain** (certificate, protocols) and the real Kratos session cookie (Secure, HttpOnly).
- **Backups and a restore on the server.** A restore was tested on this machine in phase 9A.
- **Monitoring and alerting:** there is none yet.

## Next

- **Phase 2:** a load test on this machine (k6 against the API, many simulated boards against the broker). It measures B3.
- **Phase 3:** the final report.
