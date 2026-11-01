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

#elif CONFIG_M2_BOARD_D1 || CONFIG_M2_BOARD_D2
/* Dimmers (ESP32-C3): zero-cross detector 4; TRIAC gates 5 and 6; touch keys 0 (setup) and 1. */
#define DIMMER(name, gate, key_pin) { .key = (name), .kind = M2_CH_DIMMER, .capability = "brightness", .relay_gpio = (gate), .sensor_gpio = 4, .key_gpio = (key_pin), .inhibit_gpio = -1 }
#if CONFIG_M2_BOARD_D1
#define MODEL "m2-d1-rev-a"
static const m2_channel_t channels[] = { DIMMER("ch1", 5, 0) };
#else
#define MODEL "m2-d2-rev-a"
static const m2_channel_t channels[] = { DIMMER("ch1", 5, 0), DIMMER("ch2", 6, 1) };
#endif
#define SETUP_GPIO 0
#define KEYS_ACTIVE_HIGH true
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_CL
/* Evaporative cooler (ESP32-C3): pump relay 4, motor low 5 and high 6 (never both); setup button 7; status LED 10. */
#define MODEL "m2-cl-rev-a"
static const m2_channel_t channels[] = {
    { .key = "cooler", .kind = M2_CH_COOLER, .capability = "speed", .relay_gpio = 4, .relay2_gpio = 5, .relay3_gpio = 6, .key_gpio = -1, .inhibit_gpio = -1 },
};
#define SETUP_GPIO 7
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED 10

#elif CONFIG_M2_BOARD_FN
/* Fan (ESP32-C3): low relay 4, high relay 5 (never both); touch key 0 steps the speed and is the setup key. */
#define MODEL "m2-fn-rev-a"
static const m2_channel_t channels[] = {
    { .key = "fan", .kind = M2_CH_FAN, .capability = "speed", .relay_gpio = 4, .relay2_gpio = 5, .key_gpio = 0, .inhibit_gpio = -1 },
};
#define SETUP_GPIO 0
#define KEYS_ACTIVE_HIGH true
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_CU
/*
 * Curtain (ESP32-C3): open relay 4, close relay 5 (never both); touch "open" 0 (also the setup key),
 * touch "close" 1. The motor's own end stops halt it; 30 s covers a long track.
 */
#define MODEL "m2-cu-rev-a"
static const m2_channel_t channels[] = {
    { .key = "curtain", .kind = M2_CH_CURTAIN, .capability = "curtain", .relay_gpio = 4, .relay2_gpio = 5, .key_gpio = 0, .key2_gpio = 1, .inhibit_gpio = -1, .travel_ms = 30000 },
};
#define SETUP_GPIO 0
#define KEYS_ACTIVE_HIGH true
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_GD
/* Parking door (ESP32-C3): pulse relay 4 to the door's controller; door contact 5; setup button 6; status LED 10. */
#define MODEL "m2-gd-rev-a"
static const m2_channel_t channels[] = {
    { .key = "door", .kind = M2_CH_GARAGE, .capability = "door", .relay_gpio = 4, .sensor_gpio = 5, .key_gpio = -1, .inhibit_gpio = -1, .pulse_ms = 1000 },
};
#define SETUP_GPIO 6
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED 10

#elif CONFIG_M2_BOARD_CT
/* Door and window contact (ESP32-C3): reed switch 4 to GND (closed = door closed); setup button 5. */
#define MODEL "m2-ct-rev-a"
static const m2_channel_t channels[] = {
    { .key = "contact", .kind = M2_CH_INPUT, .capability = "contact", .relay_gpio = -1, .sensor_gpio = 4, .sensor_active_high = true, .key_gpio = -1, .inhibit_gpio = -1 },
};
#define SETUP_GPIO 5
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_LK
/* Water leak (ESP32-C3): probe 4 (low = water), buzzer 5 (sounds while wet); setup button 6. */
#define MODEL "m2-lk-rev-a"
static const m2_channel_t channels[] = {
    { .key = "leak", .kind = M2_CH_INPUT, .capability = "leak", .relay_gpio = 5, .sensor_gpio = 4, .key_gpio = -1, .inhibit_gpio = -1 },
};
#define SETUP_GPIO 6
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_SM
/* Smoke (ESP32-C3): the relay contact of a certified smoke detector on 4 (closed = smoke); setup button 5. */
#define MODEL "m2-sm-rev-a"
static const m2_channel_t channels[] = {
    { .key = "smoke", .kind = M2_CH_INPUT, .capability = "smoke", .relay_gpio = -1, .sensor_gpio = 4, .key_gpio = -1, .inhibit_gpio = -1 },
};
#define SETUP_GPIO 5
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_PR
/*
 * Presence, mmWave (ESP32-C3): the LD2410's OUT pin on 4 (high = someone there, also sitting
 * still); setup button 5. Its UART (6, 7) is wired for later tuning; its factory settings serve.
 */
#define MODEL "m2-pr-rev-a"
static const m2_channel_t channels[] = {
    { .key = "presence", .kind = M2_CH_INPUT, .capability = "presence", .relay_gpio = -1, .sensor_gpio = 4, .sensor_active_high = true, .sensor_driven = true, .key_gpio = -1, .inhibit_gpio = -1 },
};
#define SETUP_GPIO 5
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED -1

#elif CONFIG_M2_BOARD_RS || CONFIG_M2_BOARD_RSAIR
/*
 * Room sensor (ESP32-C3): I²C SDA 4, SCL 5 (SHT40, BH1750, and the SCD40 on the air-quality
 * version); AM312 PIR on 6 (high = motion); setup button 7; status LED 10.
 */
#define CLIMATE { .key = "climate", .kind = M2_CH_MEASURE, .sensor = M2_SENSOR_SHT40, .capability = "humidity", .capability2 = "temperature", .relay_gpio = -1, .key_gpio = -1, .inhibit_gpio = -1 }
#define LIGHT { .key = "light", .kind = M2_CH_MEASURE, .sensor = M2_SENSOR_BH1750, .capability = "illuminance_lux", .relay_gpio = -1, .key_gpio = -1, .inhibit_gpio = -1 }
#define MOTION { .key = "motion", .kind = M2_CH_INPUT, .capability = "motion", .relay_gpio = -1, .sensor_gpio = 6, .sensor_active_high = true, .sensor_driven = true, .key_gpio = -1, .inhibit_gpio = -1 }
#if CONFIG_M2_BOARD_RS
#define MODEL "m2-rs-rev-a"
static const m2_channel_t channels[] = { CLIMATE, LIGHT, MOTION };
#else
#define MODEL "m2-rs-air-rev-a"
static const m2_channel_t channels[] = {
    CLIMATE, LIGHT, MOTION,
    { .key = "air", .kind = M2_CH_MEASURE, .sensor = M2_SENSOR_SCD40, .capability = "co2_ppm", .relay_gpio = -1, .key_gpio = -1, .inhibit_gpio = -1 },
};
#endif
#define SETUP_GPIO 7
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED 10
#define I2C_SDA 4
#define I2C_SCL 5

#elif CONFIG_M2_BOARD_CO
/* Carbon monoxide (ESP32-C3): ZE07-CO on UART1 (board RX 4, TX 5); buzzer 6; setup button 7. */
#define MODEL "m2-co-rev-a"
static const m2_channel_t channels[] = {
    { .key = "co", .kind = M2_CH_MEASURE, .sensor = M2_SENSOR_ZE07, .capability = "co_ppm", .relay_gpio = 6, .key_gpio = -1, .inhibit_gpio = -1 },
};
#define SETUP_GPIO 7
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED -1
#define UART_RX 4
#define UART_TX 5

#elif CONFIG_M2_BOARD_AL
/*
 * Alarm panel (ESP32-WROOM-32): siren relay 4; zones 1-4 (doors and windows) on 34, 35, 36, 39
 * and zones 5-6 (motion) on 32, 33, all NC contacts to GND (open = alarm), pull-ups on the PCB
 * for the input-only pins; tamper switch 25; setup button 26; status LED 27.
 */
#define MODEL "m2-al-rev-a"
#define ZONE(name, capability_name, pin) { .key = (name), .kind = M2_CH_INPUT, .capability = (capability_name), .relay_gpio = -1, .sensor_gpio = (pin), .sensor_active_high = true, .key_gpio = -1, .inhibit_gpio = -1 }
static const m2_channel_t channels[] = {
    { .key = "alarm", .kind = M2_CH_ALARM, .capability = "alarm_mode", .relay_gpio = 4, .sensor_gpio = 25, .key_gpio = -1, .inhibit_gpio = -1 },
    ZONE("zone1", "contact", 34), ZONE("zone2", "contact", 35), ZONE("zone3", "contact", 36), ZONE("zone4", "contact", 39),
    ZONE("zone5", "motion", 32), ZONE("zone6", "motion", 33),
};
#define SETUP_GPIO 26
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED 27

#elif CONFIG_M2_BOARD_CAM
/* Camera (ESP32-CAM, AI-Thinker): the camera bus is fixed by the module; setup button 13; red LED 33 (lit when LOW). */
#define MODEL "m2-cam-rev-a"
static const m2_channel_t channels[] = {
    { .key = "camera", .kind = M2_CH_CAMERA, .capability = "power", .relay_gpio = -1, .key_gpio = -1, .inhibit_gpio = -1 },
};
#define SETUP_GPIO 13
#define KEYS_ACTIVE_HIGH false
#define STATUS_LED 33
#define STATUS_LED_ACTIVE_LOW true

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

#ifndef STATUS_LED_ACTIVE_LOW
#define STATUS_LED_ACTIVE_LOW false
#endif
#ifndef I2C_SDA
#define I2C_SDA -1
#define I2C_SCL -1
#endif
#ifndef UART_RX
#define UART_RX -1
#define UART_TX -1
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
    .status_led_active_low = STATUS_LED_ACTIVE_LOW,
    .i2c_sda_gpio = I2C_SDA,
    .i2c_scl_gpio = I2C_SCL,
    .uart_rx_gpio = UART_RX,
    .uart_tx_gpio = UART_TX,
};

int m2_board_channel(const char *key)
{
    for (int i = 0; i < m2_board.channel_count; i++) {
        if (strcmp(m2_board.channels[i].key, key) == 0) return i;
    }
    return -1;
}
