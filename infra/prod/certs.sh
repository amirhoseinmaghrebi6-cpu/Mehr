#!/bin/sh
# Creates the certificates the production stack needs, in infra/prod/certs/ (gitignored). Never
# overwrites a file that exists, so it is safe to run again.
#
#   sh infra/prod/certs.sh <domain> [mqtt host]
#
# - ca/ca.key, ca/ca.crt: our own certificate authority for the boards (10 years). ca.crt goes into
#   the board firmware; keep ca.key off the server once the MQTT certificate is made (back it up
#   somewhere safe: without it no new MQTT certificate the boards trust can be made).
# - mqtt/server.key, mqtt/server.crt: the broker's TLS certificate for the mqtt host (default
#   mqtt.<domain>), signed by that authority (2 years; run again after deleting them to renew).
# - web/fullchain.pem, web/privkey.pem: a self-signed stand-in for the bought HTTPS certificate,
#   only so the stack starts; replace both files with the real ones (README.md).
set -eu
export MSYS_NO_PATHCONV=1 # Git Bash on Windows would mangle "/CN=…"

DOMAIN=${1:?usage: certs.sh <domain> [mqtt host]}
MQTT_HOST=${2:-mqtt.$DOMAIN}
mkdir -p "$(dirname "$0")/certs"
cd "$(dirname "$0")/certs"
mkdir -p ca mqtt web

if [ ! -f "ca/ca.crt" ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 3650 \
    -subj "/CN=M2smart Board CA" -keyout "ca/ca.key" -out "ca/ca.crt"
  chmod 600 "ca/ca.key"
  echo "Created the board CA: ca/ca.crt"
fi

if [ ! -f "mqtt/server.crt" ]; then
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj "/CN=$MQTT_HOST" \
    -keyout "mqtt/server.key" -out "mqtt/server.csr"
  printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\n' "$MQTT_HOST" > "mqtt/server.ext"
  openssl x509 -req -in "mqtt/server.csr" -CA "ca/ca.crt" -CAkey "ca/ca.key" \
    -CAcreateserial -days 730 -extfile "mqtt/server.ext" -out "mqtt/server.crt"
  rm "mqtt/server.csr" "mqtt/server.ext"
  # Readable by the broker's own user inside its container.
  chmod 644 "mqtt/server.key"
  echo "Created the MQTT certificate for $MQTT_HOST"
fi

if [ ! -f "web/fullchain.pem" ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN" -keyout "web/privkey.pem" -out "web/fullchain.pem"
  echo "Created a self-signed stand-in HTTPS certificate for $DOMAIN; replace it with the bought one"
fi
