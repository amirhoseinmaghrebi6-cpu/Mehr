/*
 * Wi-Fi: the home network (station) and, in pairing mode, the board's own temporary network
 * (access point "M2smart-XXXX", setup page at 192.168.4.1). Both can run at once while pairing.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>

void m2_net_init(void);

/** Joins the home network and keeps rejoining it after a drop. */
void m2_net_connect(const char *ssid, const char *password);
/** Waits until the board has an address on the home network. */
bool m2_net_wait_connected(int timeout_ms);
bool m2_net_connected(void);

void m2_net_start_ap(const char *name);
void m2_net_stop_ap(void);

/** The networks the board can see, as a JSON array of names (for the setup page). */
void m2_net_scan_json(char *out, size_t len);
