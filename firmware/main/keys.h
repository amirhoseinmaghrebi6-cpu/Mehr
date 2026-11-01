/*
 * Wall keys (TTP223 touch keys in momentary mode, or push buttons) and the setup key
 * (docs/board-protocol.md, "The setup key"):
 * - a touch switches its channel at once (a momentary channel is on while the key is held);
 * - the setup key held 7–10 s and released: pairing mode (its light blinks twice);
 * - held over 15 s within 3 minutes after power-up: factory reset (its light blinks 3 times).
 * Keys work with no Wi-Fi and no server.
 */
#pragma once

typedef void (*m2_key_action_t)(void);

/** Starts watching the keys; the two actions run on the keys' task. */
void m2_keys_start(m2_key_action_t on_pairing, m2_key_action_t on_factory_reset);
