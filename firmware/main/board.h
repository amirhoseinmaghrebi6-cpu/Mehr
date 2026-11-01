/*
 * The board this firmware is built for: its channels and pins. One table per PCB model, the same
 * pin map as its hardware catalog entry (docs/board-lineup.md). Users never change it.
 */
#pragma once

#include <stdbool.h>

/** What a channel controls. */
typedef enum {
    /** On/off relay: "power" (switch, socket, pump). */
    M2_CH_SWITCH,
    /** Pulses its relay while asked or held: "door_release" (door opener). */
    M2_CH_MOMENTARY,
} m2_channel_kind_t;

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
} m2_board_t;

extern const m2_board_t m2_board;

/** The channel with this key, or -1. */
int m2_board_channel(const char *key);
