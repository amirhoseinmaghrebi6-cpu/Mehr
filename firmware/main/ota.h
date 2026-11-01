/*
 * Firmware updates over the air (docs/board-protocol.md, "Firmware updates"). The server offers a
 * new firmware on the board's `update` topic; the board downloads it over HTTPS from the server it
 * claimed at, checks its SHA-256, writes it to the other firmware slot and restarts. Relays and
 * keys keep working meanwhile.
 *
 * A new firmware must prove itself: it is kept only once it reaches the broker. If it cannot within
 * 5 minutes, or it crashes before, the board goes back to the firmware it had.
 */
#pragma once

/** At power-up: if this firmware is new and unproven, starts the 5-minute check. */
void m2_ota_boot_check(void);
/** Called when the broker connection is up: the running firmware works, keep it. */
void m2_ota_confirm(void);
/** Handles an `update` message (JSON); ignored if it names the running version or one is under way. */
void m2_ota_offer(const char *json, int len);
