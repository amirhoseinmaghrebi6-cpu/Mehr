#!/bin/sh
# Runs meter_test.c, then channels_test.c on a PC for the motor, sensor and meter boards, inside Espressif's image (it has gcc):
#   sh firmware/test/run.sh
set -eu
cd "$(dirname "$0")/.."
project=$(pwd -W 2>/dev/null || pwd)
MSYS_NO_PATHCONV=1 docker run --rm -v "$project:/project" -w /project espressif/idf:v5.4.1 sh -c '
  gcc -std=gnu11 -Wall -Werror -Imain test/meter_test.c -lm -o /tmp/meter_test && /tmp/meter_test || exit 1
  for board in FN CL CU GD LK CT D2 AL EM; do
    gcc -std=gnu11 -Wall -Werror -Wno-unused-variable -Wno-unused-function -DCONFIG_M2_BOARD_$board=1 -Itest/stubs -Imain \
      main/channels.c main/board.c test/channels_test.c -o /tmp/channels_test && /tmp/channels_test || exit 1
  done'
