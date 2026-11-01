/*
 * The board's outputs. Every change is applied to the relays at once, saved in flash (so it comes
 * back after a power cut, before there is any internet) and reported to the cloud.
 *
 * A channel's value depends on its kind (board.h): a switch 0/1; a fan or cooler speed 0 off,
 * 1 low, 2 high; a curtain or parking door 0 closed, 1 open; a sensor input 1 while active; a
 * dimmer 0–100. A cooler also has its pump.
 * Relays of one motor are never on together, whoever asks and from whichever task.
 */
#pragma once

#include <stdbool.h>

/** A channel changed: by a wall key, the board itself, or a command from the server (with its id). */
typedef void (*m2_channel_listener_t)(int channel, const char *command_id);

/** Applies the saved states at once (power just came back). */
void m2_channels_init(void);
void m2_channels_listen(m2_channel_listener_t listener);

int m2_channel_value(int channel);
/** Coolers only. */
bool m2_channel_pump(int channel);

/** Whether a guard input keeps the channel off right now (e.g. a pump's tank is empty). */
bool m2_channel_inhibited(int channel);
/**
 * Carries out a command: `pump` picks a cooler's pump instead of its speed. Instant kinds report
 * at once; a curtain reports when it has finished moving, a parking door when its contact shows
 * the door there. False if the channel may not do it now (its guard input is active).
 */
bool m2_channel_command(int channel, bool pump, int value, const char *command_id);
/** A wall key went down or up; `second` is a curtain's "close" key. */
void m2_channel_key(int channel, bool second, bool down);
/** Guards (a pump's float switch), parking-door contacts and sensor inputs; called often (the keys' task). */
void m2_channels_poll(void);

/** Feedback without changing the saved state: a switch channel's light blinks `times` (pairing: 2, reset: 3). */
void m2_channel_blink(int channel, int times);
