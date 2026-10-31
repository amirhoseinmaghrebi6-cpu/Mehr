#!/bin/sh
# Builds the images and packs everything the server needs into m2smart-release.tar.gz (in the
# repository root, gitignored): every image of compose.yaml and the stack's files. The server
# then needs no registry, npm or GitHub: copy the file over and follow README.md.
#
#   sh infra/prod/bundle.sh
set -eu
cd "$(dirname "$0")/../.."
compose="docker compose -f infra/prod/compose.yaml --env-file infra/prod/.env.example"
$compose build
docker save $($compose config --images | sort -u) | gzip > infra/prod/images.tar.gz
tar czf m2smart-release.tar.gz infra/prod/images.tar.gz infra/prod/compose.yaml infra/prod/.env.example \
  infra/prod/certs.sh infra/prod/backup.sh infra/prod/README.md infra/prod/kratos infra/prod/mosquitto infra/prod/nginx \
  infra/dev/kratos/identity.schema.json infra/dev/kratos/courier-sms.jsonnet infra/dev/kratos/webhook-identity.jsonnet \
  infra/postgres/kratos-db.sql
rm infra/prod/images.tar.gz
echo "Written: m2smart-release.tar.gz ($(du -h m2smart-release.tar.gz | cut -f1))"
