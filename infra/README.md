# M2smart infrastructure

## Local development stack (`infra/dev`)

One command brings up the self-hosted services M2smart needs for local development, replacing `supabase start` for day-to-day work:

| Service    | Image (pinned by tag and digest in `dev/compose.yaml`) | Host address      | Container port |
|------------|---------------------------------------------------------|-------------------|----------------|
| PostgreSQL | `postgres:17.11-alpine3.24`                             | `127.0.0.1:55432` | 5432           |
| Mosquitto  | `eclipse-mosquitto:2.0.22`                              | `127.0.0.1:18830` | 1883           |
| Ory Kratos (auth, public API only) | `oryd/kratos:v25.4.0`                | `127.0.0.1:4433`  | 4433           |

The Compose project is named `m2smart-dev`, so every container, volume and network it creates is prefixed with `m2smart-dev`. Host ports are non-default and bound to `127.0.0.1` only, so they don't clash with other stacks on the machine (for example OpenRemote) and aren't reachable from the network.

### Prerequisites

- Docker Engine with the Compose v2 plugin (`docker compose version`). Docker Desktop works on Windows and macOS.
- pnpm, for the `infra:*` scripts. They are thin wrappers around `docker compose`, so you can also run the commands directly.
- The Supabase CLI is **not** needed.

### `.env` setup

```sh
cp infra/dev/.env.example infra/dev/.env
```

Then set `POSTGRES_PASSWORD` in `infra/dev/.env`. The file is gitignored (`.env*` in the root `.gitignore`); never commit it. Compose refuses to start if `POSTGRES_USER`, `POSTGRES_PASSWORD` or `POSTGRES_DB` is missing.

| Variable             | Default in `.env.example` | Purpose                                            |
|----------------------|---------------------------|----------------------------------------------------|
| `POSTGRES_USER`      | `m2smart`                 | Superuser of the dev cluster                       |
| `POSTGRES_PASSWORD`  | *(set your own)*          | Its password                                       |
| `POSTGRES_DB`        | `m2smart`                 | Database created on first start                    |
| `POSTGRES_HOST_PORT` | `55432`                   | Host port for PostgreSQL (on `127.0.0.1`)          |
| `MQTT_HOST_PORT`     | `18830`                   | Host port for MQTT (on `127.0.0.1`)                |
| `KRATOS_PUBLIC_HOST_PORT` | `4433`               | Host port for the Kratos public API (on `127.0.0.1`) |
| `KRATOS_DB_PASSWORD` | *(set your own)*          | Password of the `kratos` database role. Hex only (`openssl rand -hex 16`): it goes into a URL |
| `KRATOS_SECRETS_COOKIE` | *(set your own)*       | Signs Kratos session cookies. Long random string (`openssl rand -hex 32`) |
| `KRATOS_SECRETS_CIPHER` | *(set your own)*       | Encrypts secrets Kratos stores. **Exactly 32 characters** (`openssl rand -hex 16`) |

`POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` only take effect when the data volume is first created. After changing them, run `pnpm infra:reset`.

### Commands

| Command            | What it does                                                                                           |
|--------------------|--------------------------------------------------------------------------------------------------------|
| `pnpm infra:up`    | Starts the stack in the background and waits until every service reports healthy (`up -d --wait`).   |
| `pnpm infra:down`  | Stops and removes the containers and network. Data volumes are kept.                                   |
| `pnpm infra:reset` | Removes the containers **and the data volumes**, then starts a fresh, empty stack and waits for healthy. |

These commands only touch `m2smart-dev` resources. Other Compose projects are not affected.

### Connection details

**PostgreSQL**

```
host=127.0.0.1 port=55432 user=<POSTGRES_USER> password=<POSTGRES_PASSWORD> dbname=<POSTGRES_DB>
postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@127.0.0.1:55432/<POSTGRES_DB>
```

Open a shell inside the container (no local `psql` needed):

```sh
docker compose -f infra/dev/compose.yaml exec postgres psql -U m2smart -d m2smart
```

**Mosquitto**

```
mqtt://127.0.0.1:18830   (anonymous, plaintext)
```

Quick round-trip check inside the container:

```sh
docker compose -f infra/dev/compose.yaml exec mosquitto mosquitto_sub -t m2smart/dev/ping -C 1 -W 10 &
docker compose -f infra/dev/compose.yaml exec mosquitto mosquitto_pub -t m2smart/dev/ping -m hello
```

### Using a Docker registry mirror inside Iran

Both images are official Docker Hub images, so a Docker Hub mirror (pull-through cache) is enough. Add the mirror to the Docker daemon config:

- **Linux:** `/etc/docker/daemon.json`, then `sudo systemctl restart docker`
- **Docker Desktop:** Settings → Docker Engine, then Apply & restart

```json
{
  "registry-mirrors": ["https://<mirror-host>"]
}
```

Replace `<mirror-host>` with a Docker Hub mirror inside Iran that you trust and have verified you can reach. `docker info` lists the active mirrors under "Registry Mirrors".

The images in `compose.yaml` are pinned by digest as well as tag, so a mirror can't serve different image contents without the pull failing. When upgrading an image, update the tag and the digest together.

If no mirror is available, load the images offline on a machine that has them:

```sh
docker save postgres:17.11-alpine3.24 eclipse-mosquitto:2.0.22 oryd/kratos:v25.4.0 -o m2smart-dev-images.tar
docker load -i m2smart-dev-images.tar
```

### Local development notes

- **Dev only.** The broker accepts anonymous, unencrypted connections and has no ACLs; PostgreSQL uses a dev superuser. Broker authentication, ACLs, TLS, topic design and production deployment come in later phases. Don't expose these ports beyond `127.0.0.1`.
- **The database starts empty.** Phase 2A doesn't apply `supabase/migrations`; that is done by the migration runner in Phase 2B.
- **Data persists** in the `m2smart-dev_postgres-data` and `m2smart-dev_mosquitto-data` volumes across `infra:down`/`infra:up`. Only `infra:reset` deletes them.
- **Port already in use?** Change `POSTGRES_HOST_PORT` or `MQTT_HOST_PORT` in `infra/dev/.env`.
- The containers don't restart on their own after Docker restarts; run `pnpm infra:up` again.

### Ory Kratos (authentication)

Kratos keeps users, sessions and login flows in its own `kratos` database in the same PostgreSQL cluster; it never touches the app database. `pnpm infra:up` runs three services in order:

1. `kratos-db-init` creates the `kratos` role and database if missing (`infra/postgres/kratos-db.sql`), then exits.
2. `kratos-migrate` runs `kratos migrate sql` (Kratos's own schema), then exits. Both show as "Exited (0)", which is expected.
3. `kratos` serves the public API on `127.0.0.1:4433`. The admin API (4434) is never published to the host.

Configuration is in `infra/dev/kratos/` (`kratos.yml`, `identity.schema.json`, `courier-sms.jsonnet`); background and test results are in `docs/spikes/kratos-2d2.md`. Users sign in with a mobile number and an SMS code; a password is optional.

**SMS codes in development.** Kratos sends every SMS to the API's `POST /internal/dev/sms`, which logs it instead of sending it. Start the API (`pnpm api:dev`, with `NODE_ENV=development` in `backend/.env.local`) and read the code from its log line `DEV SMS (not sent)`. If the API isn't running, Kratos retries delivery.

Try a registration with curl:

```sh
FLOW=$(curl -s http://127.0.0.1:4433/self-service/registration/api | jq -r .id)
curl -s -X POST "http://127.0.0.1:4433/self-service/registration?flow=$FLOW" \
  -H 'content-type: application/json' -H 'accept: application/json' \
  -d '{"method":"code","traits":{"phone":"+989121234567"}}'
# read the code from the API log, then submit it:
curl -s -X POST "http://127.0.0.1:4433/self-service/registration?flow=$FLOW" \
  -H 'content-type: application/json' -H 'accept: application/json' \
  -d '{"method":"code","code":"<CODE>","traits":{"phone":"+989121234567"}}'
```

**Webhooks to the API.** `KRATOS_WEBHOOK_SECRET` must have the same value in `infra/dev/.env` (Kratos) and `backend/.env.local` (API). The API accepts the webhooks only from loopback/private addresses with that secret:

- After an SMS-code registration, Kratos calls `POST /internal/kratos/identity`; the API creates the user's row in the app database (and with it the profile and personal organization). If this call is missed, `GET /v1/me` creates the row on first use.
- A registration **with a password** is refused: Kratos calls `POST /internal/kratos/registration/password` before saving anything and the API always answers with an error. Nobody may claim a phone number without the SMS code; a password can be added after signing in.
- Kratos's `profile` settings method is off, so a phone number cannot be changed without an SMS check.

**Sign in to the web app.** With `pnpm infra:up`, `pnpm api:dev` and `pnpm dev` running, open http://localhost:3000, create an account with your name and a mobile number (e.g. `0912 345 6789`; Persian digits work too), and copy the 6-digit code from the `DEV SMS (not sent)` line in the `pnpm api:dev` terminal. The demo account stays available on the login page.

**Check a session with the API:** `curl -H "Authorization: Bearer <session_token>" http://127.0.0.1:4000/v1/me` (or forward the `ory_kratos_session` cookie).

**Iran-only operation.** `SQA_OPT_OUT=true` (telemetry) and `haveibeenpwned_enabled: false` keep Kratos from calling foreign hosts. Keep both in every environment. `--dev` (plain-HTTP cookies) is for local development only.
