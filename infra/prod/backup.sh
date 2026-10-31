#!/bin/sh
# Database backups (the backup service in compose.yaml): every night at 00:00 UTC (03:30 Tehran),
# the whole cluster, the app and Kratos, compressed into /backups (infra/prod/backups on the host).
# The last 7 are kept; older ones are deleted. `backup.sh now` makes one at once and exits.
set -eu

backup() {
  file=/backups/m2smart-$(date -u +%Y%m%d-%H%M%S).sql.gz
  pg_dumpall -h postgres -U "$POSTGRES_USER" | gzip > "$file.part"
  mv "$file.part" "$file"
  ls -1t /backups/m2smart-*.sql.gz | tail -n +8 | xargs -r rm --
  echo "Backup written: $file"
}

if [ "${1:-}" = now ]; then backup; exit; fi
while true; do
  sleep $((86400 - $(date -u +%s) % 86400))
  backup || echo "Backup failed" >&2
done
