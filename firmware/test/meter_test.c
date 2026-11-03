/* The energy meter's arithmetic on a PC (firmware/test/run.sh). */
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "meter_calc.h"

/** A BL0942 frame with these registers and a correct checksum. */
static void frame_of(uint8_t frame[23], uint32_t i_rms, uint32_t v_rms, int32_t watt)
{
    memset(frame, 0, 23);
    frame[0] = 0x55;
    for (int b = 0; b < 3; b++) {
        frame[1 + b] = (i_rms >> (8 * b)) & 0xFF;
        frame[4 + b] = (v_rms >> (8 * b)) & 0xFF;
        frame[10 + b] = ((uint32_t)watt >> (8 * b)) & 0xFF;
    }
    uint8_t sum = 0x58;
    for (int i = 0; i < 22; i++) sum += frame[i];
    frame[22] = (uint8_t)~sum;
}

int main(void)
{
    uint8_t frame[23];
    m2_meter_reading_t r;
    // 220 V, 5 A, 1100 W with round calibration numbers.
    frame_of(frame, 5 * 1000, 220 * 100, 1100 * 10);
    assert(m2_bl0942_parse(frame, 100, 1000, 10, &r));
    assert(fabsf(r.volts - 220) < 0.01f && fabsf(r.amps - 5) < 0.01f && fabsf(r.watts - 1100) < 0.01f);
    // A clamp on the wire the other way round: the same power.
    frame_of(frame, 5000, 22000, -11000);
    assert(m2_bl0942_parse(frame, 100, 1000, 10, &r) && fabsf(r.watts - 1100) < 0.01f);
    // Noise is no load.
    frame_of(frame, 1, 22000, 20);
    assert(m2_bl0942_parse(frame, 100, 1000, 10, &r) && r.watts == 0);
    // A damaged frame or a wrong header is refused.
    frame_of(frame, 5000, 22000, 11000);
    frame[5] ^= 1;
    assert(!m2_bl0942_parse(frame, 100, 1000, 10, &r));
    frame_of(frame, 5000, 22000, 11000);
    frame[0] = 0x54;
    assert(!m2_bl0942_parse(frame, 100, 1000, 10, &r));

    // Reports: 10 % (at least 50 W) or 3 V.
    assert(!m2_meter_worth_report(1000, 1090, 220, 221));
    assert(m2_meter_worth_report(1000, 1100, 220, 220));
    assert(!m2_meter_worth_report(100, 140, 220, 220));
    assert(m2_meter_worth_report(100, 150, 220, 220));
    assert(m2_meter_worth_report(1000, 1000, 220, 216.9f));

    // 1000 W for an hour is 1 kWh (10^6 mWh).
    assert(fabs(m2_meter_mwh(1000, 3600) - 1e6) < 1e-3);
    printf("meter: all checks passed\n");
    return 0;
}
