/*
 * The energy meter's arithmetic, kept apart from the hardware so test/meter_test.c can run it on a
 * PC: reading a BL0942 frame, and when a change is worth a report.
 */
#pragma once

#include <math.h>
#include <stdbool.h>
#include <stdint.h>

typedef struct {
    float volts, amps, watts;
} m2_meter_reading_t;

/** Below this the BL0942 reads noise, not a load. */
#define M2_METER_NOISE_W 3.0f

static inline uint32_t m2_le24(const uint8_t *bytes)
{
    return bytes[0] | (bytes[1] << 8) | ((uint32_t)bytes[2] << 16);
}

/**
 * A BL0942 full packet, its reply to 0x58 0xAA (datasheet, "UART"): 0x55, I_RMS[3], V_RMS[3],
 * I_FAST_RMS[3], WATT[3] (signed), CF_CNT[3], FREQ[2], STATUS[3], checksum; little-endian. The
 * checksum is the inverted low byte of 0x58 plus bytes 0–21. `*_per_unit` are the calibration:
 * register counts per volt, ampere and watt. False for a damaged frame.
 */
static inline bool m2_bl0942_parse(const uint8_t frame[23], float counts_per_volt, float counts_per_amp, float counts_per_watt, m2_meter_reading_t *out)
{
    if (frame[0] != 0x55) return false;
    uint8_t sum = 0x58;
    for (int i = 0; i < 22; i++) sum += frame[i];
    if ((uint8_t)~sum != frame[22]) return false;
    int32_t watt = (int32_t)m2_le24(frame + 10);
    if (watt & 0x800000) watt -= 0x1000000;
    out->amps = m2_le24(frame + 1) / counts_per_amp;
    out->volts = m2_le24(frame + 4) / counts_per_volt;
    // A clamp put on the wire the other way round reads negative; a home only takes power.
    out->watts = fabsf(watt / counts_per_watt);
    if (out->watts < M2_METER_NOISE_W) out->watts = 0;
    return true;
}

/** A report is worth it for 10 % more or less power (at least 50 W), or 3 V. */
static inline bool m2_meter_worth_report(float reported_watts, float watts, float reported_volts, float volts)
{
    return fabsf(watts - reported_watts) >= fmaxf(50.0f, reported_watts * 0.1f) || fabsf(volts - reported_volts) >= 3.0f;
}

/** Energy in milliwatt-hours for `watts` over `seconds`. */
static inline double m2_meter_mwh(float watts, double seconds)
{
    return watts * seconds / 3.6;
}
