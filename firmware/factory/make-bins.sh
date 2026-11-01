#!/bin/sh
# Turns a factory batch (factory-batch: <hardware id>.csv per board) into factory-partition images
# (<hardware id>.bin), with ESP-IDF's nvs_partition_gen in Espressif's Docker image.
#
#   sh firmware/factory/make-bins.sh <batch folder>
set -eu
batch=$(cd "${1:?usage: make-bins.sh <batch folder>}" && (pwd -W 2>/dev/null || pwd))
MSYS_NO_PATHCONV=1 docker run --rm -v "$batch:/batch" espressif/idf:v5.4.1 sh -c '
  for csv in /batch/*.csv; do
    case "$csv" in */manifest.csv|*/flashed.csv) continue ;; esac
    python /opt/esp/idf/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py generate "$csv" "${csv%.csv}.bin" 0x3000 >/dev/null
  done'
echo "Done: $(ls "$1"/*.bin | wc -l) factory images in $1"
