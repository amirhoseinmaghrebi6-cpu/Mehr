/*
 * The board this firmware is built for: its channels and pins. One table per PCB model, the same
 * pin map as its hardware catalog entry (docs/board-lineup.md), chosen at build time
 * (`sh firmware/build.sh <board>`). Users never change it.
 */
#pragma once

#include <stdbool.h>

/** What a channel controls. */
typedef enum {
    /** On/off relay: "power" (switch, socket, pump). */
    M2_CH_SWITCH,
    /** Pulses its relay while asked or held: "door_release" (door opener). */
    M2_CH_MOMENTARY,
    /** "speed" off/low/high: low relay `relay_gpio`, high relay `relay2_gpio`, never both on. A touch steps off → low → high → off. */
    M2_CH_FAN,
    /** A fan's speed relays (`relay2_gpio` low, `relay3_gpio` high) plus "pump" on `relay_gpio`. */
    M2_CH_COOLER,
    /**
     * "curtain" open/closed: the open relay `relay_gpio` or the close relay `relay2_gpio` (never both)
     * runs for `travel_ms`. Key `key_gpio` opens, `key2_gpio` closes.
     */
    M2_CH_CURTAIN,
    /**
     * "door" open/closed of a parking door: `relay_gpio` pulses the door's own controller; the
     * state comes only from the contact `sensor_gpio` (to GND, closed = door closed).
     */
    M2_CH_GARAGE,
    /**
     * A sensor on one input, `sensor_gpio`: value 1 while it is active (water, smoke, motion,
     * presence, a door open). `relay_gpio` may drive a buzzer that sounds while it is active, even
     * offline; otherwise -1.
     */
    M2_CH_INPUT,
    /**
     * "brightness" 0–100 of a TRIAC whose gate is `relay_gpio`; `sensor_gpio` is the zero-cross
     * detector, shared by all of a board's dimmers. A touch switches it off, or back on as it was.
     */
    M2_CH_DIMMER,
    /**
     * Measured values from `sensor` (measure.c): `capability`, and `capability2` if the sensor
     * gives two. `relay_gpio` may drive a buzzer (carbon monoxide); otherwise -1.
     */
    M2_CH_MEASURE,
    /**
     * An alarm panel: "alarm_mode" 0 disarmed, 1 armed_home, 2 armed_away, and "triggered". The
     * siren is `relay_gpio`, the box's tamper switch `sensor_gpio` (closed to GND while shut). Its
     * zones are the board's input channels: contacts guard in both armed modes, motion only when
     * away. The board sounds the siren itself, with or without internet.
     */
    M2_CH_ALARM,
} m2_channel_kind_t;

typedef enum {
    /** Sensirion SHT40 on I²C: humidity, temperature. */
    M2_SENSOR_SHT40,
    /** ROHM BH1750 on I²C: light. */
    M2_SENSOR_BH1750,
    /** Sensirion SCD40 on I²C: CO₂. */
    M2_SENSOR_SCD40,
    /** Winsen ZE07-CO on UART1: carbon monoxide. */
    M2_SENSOR_ZE07,
} m2_sensor_t;

typedef struct {
    /** The channel key in the catalog and in every message, e.g. "ch1". */
    const char *key;
    m2_channel_kind_t kind;
    /** The capability it reports, e.g. "power". */
    const char *capability;
    int relay_gpio;
    /** The wall key (touch key or button) that switches it, or -1. */
    int key_gpio;
    /** Momentary channels: how long a release from the app lasts. */
    int pulse_ms;
    /**
     * An input that keeps the channel off while it is active, or -1: a pump's float switch (open
     * when the tank is empty) stops it and refuses to start it, even with no internet.
     */
    int inhibit_gpio;
    /** The inhibit input is active when HIGH (a float switch to GND with a pull-up: open = HIGH). */
    bool inhibit_active_high;
    /** Further pins, read only by the kinds that name them above. */
    int relay2_gpio, relay3_gpio, key2_gpio, sensor_gpio;
    /** Inputs: the sensor is active when its pin reads HIGH (else LOW). */
    bool sensor_active_high;
    /** Inputs: the sensor drives its pin (a pull-down keeps a missing one quiet); otherwise it is a contact to GND with a pull-up. */
    bool sensor_driven;
    /** Measuring channels. */
    m2_sensor_t sensor;
    const char *capability2;
    /** Curtains: how long the motor runs from one end to the other. */
    int travel_ms;
} m2_channel_t;

typedef struct {
    /** The model code in the hardware catalog. */
    const char *model;
    const m2_channel_t *channels;
    int channel_count;
    /** The setup key. On touch-switch boards it is the first channel's key. */
    int setup_gpio;
    /** A GPIO HIGH turns a relay on (through a ULN2803). */
    bool relay_active_high;
    /** Keys read HIGH while pressed (TTP223 touch keys) or LOW (push buttons to GND). */
    bool keys_active_high;
    /** A status LED (steady: connected; slow blink: pairing mode), or -1. */
    int status_led_gpio;
    /** Boards with measuring sensors: their I²C bus or UART1. */
    int i2c_sda_gpio, i2c_scl_gpio, uart_rx_gpio, uart_tx_gpio;
} m2_board_t;

extern const m2_board_t m2_board;

/**
 * "M2MODEL=<code>;" inside the image: the server reads it when an operator uploads a firmware, so
 * a firmware built for another board is never sent to this one (backend/src/firmware/releases.ts).
 */
extern const char m2_model_marker[];

/** The channel with this key, or -1. */
int m2_board_channel(const char *key);
