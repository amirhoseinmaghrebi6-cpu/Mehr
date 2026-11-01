/*
 * What the board keeps in flash:
 * - "nvs" partition (erased by a factory reset): home Wi-Fi, broker account, channel states;
 * - "m2factory" partition (written at production, never erased): hardware id and factory secret.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

esp_err_t m2_storage_init(void);

/** Factory identity. False if the board was never provisioned. */
bool m2_factory_identity(char *uid, size_t uid_len, char *secret, size_t secret_len);

bool m2_load_wifi(char *ssid, size_t ssid_len, char *password, size_t password_len);
esp_err_t m2_save_wifi(const char *ssid, const char *password);

/** The broker account the server gave at pairing. */
bool m2_load_account(char *board_id, size_t board_id_len, char *secret, size_t secret_len);
esp_err_t m2_save_account(const char *board_id, const char *secret);
esp_err_t m2_forget_account(void);

/** A channel's saved on/off state (false if never saved). */
bool m2_load_channel(int channel);
void m2_save_channel(int channel, bool on);

/** Factory reset: erases everything but the factory identity. */
esp_err_t m2_erase_all(void);
