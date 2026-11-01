/*
 * Pairing mode (docs/board-protocol.md, "Pairing"): for 5 minutes the board opens its own Wi-Fi
 * "M2smart-XXXX" with a setup page at http://192.168.4.1. The page takes the home Wi-Fi and the
 * setup code (filled in by the app's link, or typed); the board joins the Wi-Fi, claims with the
 * code, keeps its broker account and restarts as a paired board.
 */
#pragma once

void m2_setup_start(const char *uid, const char *factory_secret);
