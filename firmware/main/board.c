/*
 * The boards' pin tables (docs/board-lineup.md), one per model, chosen by CONFIG_M2_BOARD_*
 * (firmware/build.sh <board>). Every table must match its hardware catalog entry
 * (supabase/migrations/202611040001_chips_and_board_lineup.sql).
 */
#include <string.h>
#include "board.h"
#include "sdkconfig.h"

/** A switch channel: relay, and its key or -1. */
#define SWITCH(name, relay_pin, key_pin) { .key = (name), .kind = M2_CH_SWITCH, .capability = "power", .relay_gpio = (relay_pin), .key_gpio = (key_pin), .inhibit_gpio = -1 }

#if CONFIG_M2_BOARD_DEVKIT
/*
 * DevKit test board: an ESP32-WROOM-32 DevKit with two LEDs for relays and two keys (TTP223
 * modules or push buttons). Key 1 is also the setup key, as on a touch switch.
 *   GPIO 16 relay 1 (LED + 220 Ω to GND)   GPIO 32 key 1 (setup key)
 *   GPIO 17 relay 2 (LED + 220 Ω to GND)   GPIO 33 key 2
 */
#define MODEL "devkit-2ch-rev-a"
static const m2_channel_t channels[] = { SWITCH("ch1", 16, 32), SWITCH("ch2", 17, 33) };
#define SETUP_GPIO 32
#ifdef CONFIG_M2_KEYS_BUTTON
#define KEYS_ACTIVE_HIGH false
#else
#define KEYS_ACTIVE_HIGH true
#endif
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_T1 || CONFIG_M2_BOARD_T2 || CONFIG_M2_BOARD_T3 || CONFIG_M2_BOARD_T4
/* Touch switches, 1 to 4 keys (ESP32-C3): relays 4, 5, 6, 7; TTP223 keys 0 (setup), 1, 3, 10. */
#if CONFIG_M2_BOARD_T1
#define MODEL "m2-t1-rev-a"
static const m2_channel_t channels[] = { SWITCH("ch1", 4, 0) };
#elif CONFIG_M2_BOARD_T2
#define MODEL "m2-t2-rev-a"
static const m2_channel_t channels[] = { SWITCH("ch1", 4, 0), SWITCH("ch2", 5, 1) };
#elif CONFIG_M2_BOARD_T3
#define MODEL "m2-t3-rev-a"
static const m2_channel_t channels[] = { SWITCH("ch1", 4, 0), SWITCH("ch2", 5, 1), SWITCH("ch3", 6, 3) };
#else
#define MODEL "m2-t4-rev-a"
static const m2_channel_t channels[] = { SWITCH("ch1", 4, 0), SWITCH("ch2", 5, 1), SWITCH("ch3", 6, 3), SWITCH("ch4", 7, 10) };
#endif
#define SETUP_GPIO 0
#define KEYS_ACTIVE_HIGH true
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_R8
/* 8-relay panel board (ESP32-WROOM-32). Keys 6-8 sit on input-only pins: their pull resistors are on the PCB. */
#define MODEL "m2-r8-rev-a"
static const m2_channel_t channels[] = {
    SWITCH("ch1", 4, 23), SWITCH("ch2", 13, 25), SWITCH("ch3", 16, 26), SWITCH("ch4", 17, 27),
    SWITCH("ch5", 18, 32), SWITCH("ch6", 19, 34), SWITCH("ch7", 21, 35), SWITCH("ch8", 22, 39),
};
#define SETUP_GPIO 36
#define KEYS_ACTIVE_HIGH true
#define STATUS_LED 33

#elif CONFIG_M2_BOARD_SK
/* Smart socket (ESP32-C3): relay 4; push button 5 switches it and is the setup key. */
#define MODEL "m2-sk-rev-a"
static const m2_channel_t channels[] = { SWITCH("socket", 4, 5) };
#define SETUP_GPIO 5
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_DO
/* Door opener (ESP32-C3): strike relay 4, released 5 s from the app or while button 5 is held (also the setup key). */
#define MODEL "m2-do-rev-a"
static const m2_channel_t channels[] = {
    { .key = "door", .kind = M2_CH_MOMENTARY, .capability = "door_release", .relay_gpio = 4, .key_gpio = 5, .pulse_ms = 5000, .inhibit_gpio = -1 },
};
#define SETUP_GPIO 5
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_PM
/* Water pump (ESP32-C3): contactor relay 4; setup button 5; float switch 6 (open = tank empty) guards against running dry. */
#define MODEL "m2-pm-rev-a"
static const m2_channel_t channels[] = {
    { .key = "pump", .kind = M2_CH_SWITCH, .capability = "power", .relay_gpio = 4, .key_gpio = -1, .inhibit_gpio = 6, .inhibit_active_high = true },
};
#define SETUP_GPIO 5
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED -1

#else
#error "No board chosen: build with sh firmware/build.sh <board>"
#endif

const char m2_model_marker[] = "M2MODEL=" MODEL ";";

const m2_board_t m2_board = {
    .model = MODEL,
    .channels = channels,
    .channel_count = sizeof(channels) / sizeof(channels[0]),
    .setup_gpio = SETUP_GPIO,
    .relay_active_high = true,
    .keys_active_high = KEYS_ACTIVE_HIGH,
    .status_led_gpio = STATUS_LED,
};

int m2_board_channel(const char *key)
{
    for (int i = 0; i < m2_board.channel_count; i++) {
        if (strcmp(m2_board.channels[i].key, key) == 0) return i;
    }
    return -1;
}
