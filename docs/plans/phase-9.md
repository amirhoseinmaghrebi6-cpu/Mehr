# Phase 9 plan: running on a server in Iran

Status: in progress (started 2026-10-31).

**Goal:** everything needed to run M2smart on one server inside Iran: production images, HTTPS, MQTT over TLS for the boards, limits against abuse, and backups. All of it is tested on the development machine first, because there is no server yet.

## Steps

| Step | What |
|------|------|
| 9A | The production stack (done): Docker images for the web app and the API; `infra/prod` with nginx (HTTPS, security headers, request limits), Kratos, Mosquitto with TLS on 8883, PostgreSQL, the setup jobs and nightly backups; an SMS limit per phone number; a release bundle that holds every image, so the server needs no foreign registry. Tested from an unpacked bundle on this machine. |
| 9B | The real server: when one is bought. Follow `infra/prod/README.md`, install the bought HTTPS certificate, then test real sign-in, a real board, and a restore. |

## Decisions (2026-10-31)

- No server yet: the stack is built and tested on the development machine as if it were the server.
- HTTPS uses a bought one-year certificate, which does not depend on international internet. A self-signed stand-in lets the stack start until it is installed.
- The boards' broker uses our own certificate authority (made by `certs.sh`). Its `ca.crt` goes into the firmware, and its key is kept offline.
- Backups: every night, the last 7 kept. They hold only the current state (commands older than 24 hours are already deleted).
- Images are built on the development machine and copied to the server in one file (`bundle.sh`). The server never pulls, so the compose file names images by exact tag.
- The API bundles all its npm packages into one file, so its image has no `node_modules`: about 200 MB, down from 940 MB.
- Code SMS: at most 5 an hour per number, kept in the API's memory. That holds while one API process runs.
- The demo stays on in production, with sample data only and its own signing key.

## 9A tests (2026-10-31)

- From an unpacked bundle in an empty folder: every service healthy.
- Browser over HTTPS: the demo signs in and works, and its cookie is Secure and HttpOnly. A real sign-up reaches the code step, and Kratos hands the code to the API. There were no page errors and no CSP violations.
- MQTT: a connection over TLS that trusts our CA is accepted; one without it is refused.
- nginx: after 6 quick sign-in posts the next ones get 429; page loads are not limited.
- A backup restored into a fresh PostgreSQL: all 23 migrations and the Kratos database came back.
- API unit test: the sixth code to the same number within an hour is dropped.
