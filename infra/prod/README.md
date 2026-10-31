# M2smart production server

One server inside Iran runs the whole stack with Docker Compose (`compose.yaml`):

| Service | What it does | Reachable from outside |
|---------|--------------|------------------------|
| nginx | HTTPS front door, security headers, request limits | 80 (redirects), 443 |
| web | The Next.js app; proxies `/api/v1/*` to the API | no |
| api | The M2smart API | no |
| kratos | Sign-in (SMS code, optional password) | no |
| mosquitto | MQTT for the boards: TLS on 8883 with our own CA; plaintext 1883 inside the network for the API | 8883 |
| postgres | The database (app and Kratos) | no |
| backup | A compressed dump every night, the last 7 kept | no |
| migrate, kratos-db-init, kratos-migrate | One-shot setup jobs on every start | no |

Nothing on the server reaches a foreign host at runtime. SMS goes to IranPayamak, which is inside Iran. The server never pulls images and never runs npm: everything arrives in one bundle.

## What you need

- A Linux VPS in an Iranian data centre: Ubuntu 24.04, 2 vCPU, 4 GB RAM and 40 GB disk are enough to start.
- Docker Engine with the Compose plugin. Install it from a mirror inside Iran; most Iranian hosts document one, and a registry mirror is described in [../README.md](../README.md).
- DNS: an `A` record for the domain (for example `m2smart.ir`) and one for `mqtt.<domain>`, both pointing at the server.
- The bought HTTPS certificate for the domain: the certificate with its intermediate chain, and its private key.
- Firewall: allow only 22 (SSH), 80, 443 and 8883.

## First install

On the development machine (it needs npm and Docker Hub, but the server does not):

```sh
sh infra/prod/bundle.sh                    # writes m2smart-release.tar.gz (about 200 MB)
scp m2smart-release.tar.gz user@server:~/
```

On the server:

```sh
mkdir m2smart && cd m2smart
tar xzf ~/m2smart-release.tar.gz
gunzip -c infra/prod/images.tar.gz | docker load && rm infra/prod/images.tar.gz
cp infra/prod/.env.example infra/prod/.env
nano infra/prod/.env                       # set every value (see the comments in the file)
sh infra/prod/certs.sh m2smart.ir          # board CA, MQTT certificate, stand-in HTTPS certificate
```

Put the bought certificate in place of the stand-in:

- `infra/prod/certs/web/fullchain.pem`: the certificate followed by the intermediate certificates, in one file;
- `infra/prod/certs/web/privkey.pem`: its private key.

Then start everything:

```sh
docker compose -f infra/prod/compose.yaml --env-file infra/prod/.env up -d --wait --pull never
```

Check that `https://<domain>/login` opens, the demo works, and a real sign-in code arrives by SMS.

**Board CA.** `infra/prod/certs/ca/ca.crt` goes into the board firmware. Copy `ca/ca.key` somewhere safe and offline, then delete it from the server: whoever has it can make a broker certificate the boards trust. You need it again only to renew the MQTT certificate.

## Updating

Make a new bundle, copy it over, unpack it into the same folder (your `.env`, `certs/` and `backups/` are not in the bundle, so they stay), load the images and run the same `up` command. Database migrations run on every start, and the containers that changed are replaced.

## Backups

- Every night at 00:00 UTC (03:30 Tehran) the `backup` service writes `infra/prod/backups/m2smart-<date>.sql.gz`, which holds the app and Kratos. The last 7 are kept.
- Copy them off the server regularly (for example with `scp`): a backup that sits only on the server is lost with the server.
- Make one now: `docker compose -f infra/prod/compose.yaml --env-file infra/prod/.env exec backup sh /backup.sh now`

To restore one into an empty database:

```sh
c="docker compose -f infra/prod/compose.yaml --env-file infra/prod/.env"
$c down
docker volume rm m2smart_postgres-data
$c up -d --wait postgres
gunzip -c infra/prod/backups/m2smart-<date>.sql.gz | $c exec -T postgres psql -q -U m2smart -d postgres
$c up -d --wait --pull never
```

"Already exists" messages during the restore are expected (the roles and the empty database are created at start).

## Renewals

- **HTTPS certificate:** once a year, replace the two files in `certs/web/`, then reload nginx: `$c exec nginx nginx -s reload`.
- **MQTT certificate** (2 years): bring `ca/ca.key` back, delete `certs/mqtt/server.*`, run `certs.sh` again and restart mosquitto. The boards keep working because they trust the CA, not the certificate.

## Limits in place

- nginx: 10 sign-in, sign-up or code requests a minute per address (a burst of 5), and 30 requests a second per address overall.
- The API: at most 5 SMS codes an hour per phone number.
- Logs: 10 MB × 3 files per container.
