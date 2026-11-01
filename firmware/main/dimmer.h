/*
 * Phase-cut dimming of TRIACs (docs/board-lineup.md, "M2-D1 / M2-D2"). A zero-cross detector
 * pulses at every mains zero crossing (100 times a second at 50 Hz); after a delay that sets the
 * brightness, the board pulses each TRIAC's gate through its optocoupler. The TRIAC then conducts
 * until the next zero crossing. Later firing = less of each half-wave = dimmer.
 */
#pragma once

/** Starts dimming `count` gates (channels 0 … count-1), all off. */
void m2_dimmer_start(int zero_cross_gpio, const int *gate_gpios, int count);
/** 0 = off, 1–100 = brightness. Takes effect at the next half-wave. */
void m2_dimmer_set(int channel, int brightness);
