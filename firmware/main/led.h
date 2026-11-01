/*
 * Showing the board's state to the person holding it:
 * - the status LED, if the board has one: steady while connected to the broker, a slow blink in
 *   pairing mode, off otherwise;
 * - short feedback for the setup key (pairing: 2 blinks, reset: 3) on the status LED, or else on
 *   the setup key's own light. Never by switching a door strike or a pump: that would open the
 *   door or start the motor.
 */
#pragma once

#include <stdbool.h>

typedef enum { M2_LED_OFF, M2_LED_ON, M2_LED_BLINK } m2_led_mode_t;

void m2_led_init(void);
void m2_led_set(m2_led_mode_t mode);
/** Blinks `times` to confirm a setup-key action (blocks for about half a second per blink). */
void m2_feedback(int times);
