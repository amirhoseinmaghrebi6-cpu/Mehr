/*
 * Measuring sensors (docs/board-lineup.md, "Sensors"): read every few seconds on their own task,
 * reported when a value changes enough to matter, and with every other value every 10 minutes
 * (cloud.c). A sensor that does not answer reports nothing, so the app shows no made-up number.
 */
#pragma once

#include <stdbool.h>

/** Measuring channels changed; `listener` is told per channel (as for channels.h). */
void m2_measure_start(void (*listener)(int channel, const char *command_id));
/** The channel's first (`second` = false) or second value, e.g. humidity and temperature; false if there is none yet. */
bool m2_measure_value(int channel, bool second, float *value);
