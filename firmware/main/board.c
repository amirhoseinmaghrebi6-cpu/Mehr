/*
 * DevKit test board ("devkit-2ch-rev-a"): an ESP32-WROOM-32 DevKit with two LEDs for relays and
 * two keys (TTP223 modules or push buttons). Key 1 is also the setup key, as on a touch switch.
 *
 *   GPIO 16  relay 1 (LED + 220 Ω to GND)      GPIO 32  key 1 (setup key)
 *   GPIO 17  relay 2 (LED + 220 Ω to GND)      GPIO 33  key 2
 *
 * Production boards get their own table here, chosen at build time, when their PCBs are final.
 */
#include <string.h>
#include "board.h"

static const m2_channel_t channels[] = {
    { .key = "ch1", .kind = M2_CH_SWITCH, .capability = "power", .relay_gpio = 16, .key_gpio = 32 },
    { .key = "ch2", .kind = M2_CH_SWITCH, .capability = "power", .relay_gpio = 17, .key_gpio = 33 },
};

const m2_board_t m2_board = {
    .model = "devkit-2ch-rev-a",
    .channels = channels,
    .channel_count = sizeof(channels) / sizeof(channels[0]),
    .setup_gpio = 32,
    .relay_active_high = true,
};

int m2_board_channel(const char *key)
{
    for (int i = 0; i < m2_board.channel_count; i++) {
        if (strcmp(m2_board.channels[i].key, key) == 0) return i;
    }
    return -1;
}
