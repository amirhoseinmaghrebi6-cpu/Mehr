/*
 * The board's outputs. Every change is applied to the relay at once, saved in flash (so it comes
 * back after a power cut, before there is any internet) and reported to the cloud.
 */
#pragma once

#include <stdbool.h>

/** Who changed a channel: a wall key, a command from the server (with its id), or the board. */
typedef void (*m2_channel_listener_t)(int channel, bool on, const char *command_id);

/** Applies the saved states at once (power just came back). */
void m2_channels_init(void);
void m2_channels_listen(m2_channel_listener_t listener);

bool m2_channel_is_on(int channel);
void m2_channel_set(int channel, bool on, const char *command_id);
void m2_channel_toggle(int channel);
/** Momentary channels: on for `ms`, then off again. */
void m2_channel_pulse(int channel, int ms, const char *command_id);

/** Feedback without changing the saved state: the channel's light blinks `times` (pairing: 2, reset: 3). */
void m2_channel_blink(int channel, int times);
