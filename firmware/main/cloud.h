/*
 * The connection to the boards' broker (docs/board-protocol.md): MQTT over TLS, logged in with the
 * account the server gave at pairing. On connect the board says it is online, takes the commands
 * still valid for it, and reports every channel; after that it reports each change.
 */
#pragma once

#include <stdbool.h>

void m2_cloud_start(const char *board_id, const char *broker_secret);
bool m2_cloud_connected(void);
/** Reports a channel change: from a wall key (no id) or as the result of a command. */
void m2_cloud_report(int channel, const char *command_id);
/** Factory reset: tells the server (best effort), so it deletes the board at once. */
void m2_cloud_say_reset(void);
