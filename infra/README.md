# M2smart infrastructure

## Local development stack (`infra/dev`)

One command brings up the self-hosted services M2smart needs for local development, replacing `supabase start` for day-to-day work:

| Service    | Image (pinned by tag and digest in `dev/compose.yaml`) | Host address      | Container port |
|------------|---------------------------------------------------------|-------------------|----------------|
| PostgreSQL | `postgres:17.11-alpine3.24`                             | `127.0.0.1:55432` | 5432           |
| Mosquitto  | `eclipse-mosquitto:2.0.22`                              | `127.0.0.1:18830` | 1883           |

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
docker save postgres:17.11-alpine3.24 eclipse-mosquitto:2.0.22 -o m2smart-dev-images.tar
docker load -i m2smart-dev-images.tar
```

### Local development notes

- **Dev only.** The broker accepts anonymous, unencrypted connections and has no ACLs; PostgreSQL uses a dev superuser. Broker authentication, ACLs, TLS, topic design and production deployment come in later phases. Don't expose these ports beyond `127.0.0.1`.
- **The database starts empty.** Phase 2A doesn't apply `supabase/migrations`; that is done by the migration runner in Phase 2B.
- **Data persists** in the `m2smart-dev_postgres-data` and `m2smart-dev_mosquitto-data` volumes across `infra:down`/`infra:up`. Only `infra:reset` deletes them.
- **Port already in use?** Change `POSTGRES_HOST_PORT` or `MQTT_HOST_PORT` in `infra/dev/.env`.
- The containers don't restart on their own after Docker restarts; run `pnpm infra:up` again.
