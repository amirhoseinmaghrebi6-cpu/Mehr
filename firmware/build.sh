#!/bin/sh
# Builds the firmware of one board inside Espressif's image and copies what flashing needs to
# firmware/dist/<board>/, where Windows can reach it. Each board has its own build folder,
# settings and compiler cache in Docker volumes, which is much faster than building in a
# Windows folder, and keeps one board's settings from leaking into another's.
#
#   sh firmware/build.sh <board>          production (m2smart.ir)
#   sh firmware/build.sh <board> dev      against the dev stack (firmware/sdkconfig.dev)
#
# Boards: devkit, t1, t2, t3, t4, r8, d1, d2, sk, do, pm, cl, fn, cu, gd, ct, lk, sm, pr, rs, rsair, co, al, cam (main/board.c, docs/board-lineup.md).
# A factory partition (firmware/provision/*.csv from pnpm dev:devkit) is turned into a .bin too.
set -eu
cd "$(dirname "$0")"
board=${1:?usage: build.sh <board> [dev]   boards: devkit t1 t2 t3 t4 r8 d1 d2 sk do pm cl fn cu gd ct lk sm pr rs rsair co al cam}
case "$board" in
  devkit|r8|al|cam) target=esp32 ;;
  t1|t2|t3|t4|d1|d2|sk|do|pm|cl|fn|cu|gd|ct|lk|sm|pr|rs|rsair|co) target=esp32c3 ;;
  *) echo "Unknown board: $board" >&2; exit 1 ;;
esac
mode=${2:-prod}
defaults="sdkconfig.defaults"
[ "$mode" = dev ] && defaults="$defaults;sdkconfig.dev"
# The board choice, as a settings file the build reads last.
upper=$(echo "$board" | tr '[:lower:]' '[:upper:]')
printf 'CONFIG_M2_BOARD_%s=y\n' "$upper" > "sdkconfig.board"
# A board's own settings, if it has any (the camera needs PSRAM).
[ -f "sdkconfig.$board" ] && cat "sdkconfig.$board" >> "sdkconfig.board"
defaults="$defaults;sdkconfig.board"

project=$(pwd -W 2>/dev/null || pwd)
volume="m2-fw-$board-$mode"
MSYS_NO_PATHCONV=1 docker run --rm -e IDF_CCACHE_ENABLE=1 \
  -v "$project:/project" -v "$volume:/project/build" -v m2-fw-ccache:/root/.ccache -w /project \
  espressif/idf:v5.4.1 sh -c "
    idf.py -D IDF_TARGET=$target -D SDKCONFIG=build/sdkconfig -D SDKCONFIG_DEFAULTS='$defaults' build &&
    out=dist/$board && rm -rf \$out && mkdir -p \$out/bootloader \$out/partition_table &&
    cp build/bootloader/bootloader.bin \$out/bootloader/ && cp build/partition_table/partition-table.bin \$out/partition_table/ &&
    cp build/ota_data_initial.bin build/m2smart-board.bin build/flash_args \$out/ &&
    for csv in provision/*.csv; do [ -f \"\$csv\" ] || continue;
      python /opt/esp/idf/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py generate \"\$csv\" \"\${csv%.csv}.bin\" 0x3000 >/dev/null; done"
rm -f sdkconfig.board
echo "Done: firmware/dist/$board ($target, $mode)"
