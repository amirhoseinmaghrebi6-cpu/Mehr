#!/bin/sh
# Builds the firmware inside Espressif's image and copies what flashing needs to firmware/dist/,
# where Windows can reach it. The build folder and the compiler cache live in Docker volumes,
# which is much faster than building in a Windows folder.
#
#   sh firmware/build.sh            production (m2smart.ir)
#   sh firmware/build.sh dev        a DevKit against the dev stack (firmware/sdkconfig.dev)
#
# A factory partition (firmware/provision/*.csv from pnpm dev:devkit) is turned into a .bin too.
set -eu
cd "$(dirname "$0")"
defaults="sdkconfig.defaults"
[ "${1:-}" = dev ] && defaults="sdkconfig.defaults;sdkconfig.dev"
# Settings from the other kind of build must not stay behind.
if [ -f sdkconfig ] && [ "$(cat .last-build 2>/dev/null)" != "${1:-prod}" ]; then rm sdkconfig; fi
echo "${1:-prod}" > .last-build
project=$(pwd -W 2>/dev/null || pwd)
MSYS_NO_PATHCONV=1 docker run --rm -e IDF_CCACHE_ENABLE=1 \
  -v "$project:/project" -v m2-fw-build:/project/build -v m2-fw-ccache:/root/.ccache -w /project \
  espressif/idf:v5.4.1 sh -c "
    idf.py -D SDKCONFIG_DEFAULTS='$defaults' build &&
    rm -rf dist && mkdir -p dist/bootloader dist/partition_table &&
    cp build/bootloader/bootloader.bin dist/bootloader/ && cp build/partition_table/partition-table.bin dist/partition_table/ &&
    cp build/ota_data_initial.bin build/m2smart-board.bin build/flash_args dist/ &&
    for csv in provision/*.csv; do [ -f \"\$csv\" ] || continue;
      python /opt/esp/idf/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py generate \"\$csv\" \"\${csv%.csv}.bin\" 0x3000 >/dev/null; done"
echo "Done: firmware/dist (flash it from there; firmware/README.md)"
