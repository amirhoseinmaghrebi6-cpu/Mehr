# Phase 2D-2 spike: Ory Kratos (self-hosted)

**Date:** 2026-09-29 · **Result: go with Kratos.** All seven required items work on the self-hosted open-source build without patching Kratos, so the Better Auth fallback is not needed.

Spike code lives on the throwaway branch `spike/kratos-2d2` (`spike/kratos/`). It is not merged.

## Setup

- `oryd/kratos:v25.4.0` (`sha256:e8014c6c58b68e9d8bea4160d3e271b0d05b3db221af379afb6798b603e88ee9`), in-memory database.
- Kratos and a small Node service (standing in for the SMS provider and the M2smart API webhook) ran on a Docker network with `internal: true`, so **no route to the internet at all**. Every check below passed under that condition.
- Identity schema: `phone` (E.164, required) is the identifier for both the `code` method (via SMS) and the `password` method; `name` is optional.
- Automated check script: `spike/kratos/test.mjs`, 21/21 checks passed.

## Results

| # | Requirement | Result |
|---|---|---|
| 1 | Passwordless registration and login by SMS code with a phone number | ✅ Code sent on submit, wrong code rejected, correct code signs in the same identity |
| 2 | Courier sends SMS through a generic HTTP channel | ✅ `courier.channels[sms]` of type `http`, body shaped by a Jsonnet template, so an Iranian SMS provider needs config only |
| 3 | UUID identity ids | ✅ |
| 4 | Registration webhook to our API | ✅ `web_hook` after registration posts `identity_id`, `phone`, `name`, with an `X-Webhook-Secret` header |
| 5 | Server-side browser flows (what Next.js will do): cookies and CSRF | ✅ Flow returns a CSRF token and cookie; a submit without the cookie is refused with `security_csrf_violation`; login sets an `HttpOnly; SameSite=Lax` session cookie |
| 6 | Session check and logout | ✅ `/sessions/whoami` works with the session token (API) and the forwarded cookie (browser); API and browser logout both revoke the session |
| 7 | Optional password (decision D1) | ✅ Registration needs only a phone number; a signed-in user can add a password in settings and then log in with phone and password; wrong password rejected |

## Findings that affect later steps

1. **Kratos v26.2.0 crashes on this machine** (segfault, exit 139, reproducible after a fresh pull). v25.4.0 and v1.3.1 run normally. Pin v25.4.0 by digest in 2D-3, and re-test v26.x on the production server's CPU before any upgrade.
2. **Two settings are required for Iran-only operation:**
   - `SQA_OPT_OUT=true` turns off Ory's anonymous usage telemetry, which would call a foreign host.
   - `selfservice.methods.password.config.haveibeenpwned_enabled: false` turns off the HaveIBeenPwned lookup, a foreign service, on password set.

   With both, Kratos logged no outbound connection attempts.
3. **Recovery by SMS is not offered.** The recovery flow only accepts an email address. Under D1 this is not a blocker: a user who forgets their password signs in with an SMS code and sets a new password in settings. In 2E, "Forgot password" should lead to SMS-code login rather than a separate recovery flow.
4. **Code guessing is limited:** after 5 wrong codes the code is invalidated and even the right code is refused until a new one is requested.
5. **Code requests are not rate-limited by Kratos.** Anyone can trigger SMS sends repeatedly (cost and abuse). Limits per phone number and per IP must sit in front of Kratos (API or reverse proxy). Recommend adding them when real SMS delivery is connected, not waiting for Phase 9.
6. **Registration is two-step in the UI** (profile first, then the code), which suits the planned phone → code screens.
7. **Dev mode only in the spike:** `--dev` drops the `Secure` cookie flag and relaxes checks. Production needs HTTPS, secrets from the environment, and a real PostgreSQL database (planned for 2D-3).

## Recommendation for 2D-3

Use `oryd/kratos:v25.4.0` pinned by digest, its own `kratos` database in the dev PostgreSQL cluster, the identity schema and courier template from the spike, the two Iran-only settings above, and the webhook secret from `.env`. Keep the admin API unexposed and the public API on 127.0.0.1.
