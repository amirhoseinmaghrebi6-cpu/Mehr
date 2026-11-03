/*
 * The whole-home energy meter (M2-EM, docs/board-lineup.md): a BL0942 on UART1, read every second.
 * The board adds up its own kWh total (kept in flash, so a power cut loses at most 0.1 kWh) and
 * the server turns that total into hourly and daily use.
 */
#pragma once

#include <stdbool.h>

/** Starts reading if the board has a meter channel; `listener` hears of changes worth a report. */
void m2_meter_start(void (*listener)(int channel, const char *command_id));
/** Power (W), voltage (V) and the running total (kWh); false before the first good reading. */
bool m2_meter_values(float *watts, float *volts, double *kwh);
/** True at most once every 9 minutes (and on the first call): the total rides on that report. */
bool m2_meter_energy_due(void);
