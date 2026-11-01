#include <stdio.h>
#include <string.h>
#include "nvs.h"
#include "nvs_flash.h"
#include "esp_log.h"
#include "storage.h"

static const char *TAG = "storage";
static const char *NS = "m2";
static const char *FACTORY_PARTITION = "m2factory";

esp_err_t m2_storage_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    if (err != ESP_OK) return err;
    // The factory partition may be missing on a board that was never provisioned.
    if (nvs_flash_init_partition(FACTORY_PARTITION) != ESP_OK) ESP_LOGW(TAG, "No factory identity partition");
    return ESP_OK;
}

static bool read_str(nvs_handle_t handle, const char *key, char *out, size_t len)
{
    size_t size = len;
    return nvs_get_str(handle, key, out, &size) == ESP_OK && out[0] != '\0';
}

bool m2_factory_identity(char *uid, size_t uid_len, char *secret, size_t secret_len)
{
    nvs_handle_t handle;
    if (nvs_open_from_partition(FACTORY_PARTITION, "m2factory", NVS_READONLY, &handle) != ESP_OK) return false;
    bool ok = read_str(handle, "uid", uid, uid_len) && read_str(handle, "secret", secret, secret_len);
    nvs_close(handle);
    return ok;
}

static bool load_pair(const char *key_a, char *a, size_t a_len, const char *key_b, char *b, size_t b_len)
{
    nvs_handle_t handle;
    if (nvs_open(NS, NVS_READONLY, &handle) != ESP_OK) return false;
    bool ok = read_str(handle, key_a, a, a_len);
    // The second value may be empty (an open Wi-Fi network has no password).
    size_t size = b_len;
    if (nvs_get_str(handle, key_b, b, &size) != ESP_OK) b[0] = '\0';
    nvs_close(handle);
    return ok;
}

static esp_err_t save_pair(const char *key_a, const char *a, const char *key_b, const char *b)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;
    err = nvs_set_str(handle, key_a, a);
    if (err == ESP_OK) err = nvs_set_str(handle, key_b, b);
    if (err == ESP_OK) err = nvs_commit(handle);
    nvs_close(handle);
    return err;
}

bool m2_load_wifi(char *ssid, size_t ssid_len, char *password, size_t password_len)
{
    return load_pair("wifi_ssid", ssid, ssid_len, "wifi_pass", password, password_len);
}

esp_err_t m2_save_wifi(const char *ssid, const char *password)
{
    return save_pair("wifi_ssid", ssid, "wifi_pass", password);
}

bool m2_load_account(char *board_id, size_t board_id_len, char *secret, size_t secret_len)
{
    return load_pair("board_id", board_id, board_id_len, "broker_pw", secret, secret_len) && secret[0] != '\0';
}

esp_err_t m2_save_account(const char *board_id, const char *secret)
{
    return save_pair("board_id", board_id, "broker_pw", secret);
}

esp_err_t m2_forget_account(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;
    nvs_erase_key(handle, "board_id");
    nvs_erase_key(handle, "broker_pw");
    err = nvs_commit(handle);
    nvs_close(handle);
    return err;
}

bool m2_load_channel(int channel)
{
    char key[12];
    snprintf(key, sizeof(key), "st%d", channel);
    nvs_handle_t handle;
    uint8_t value = 0;
    if (nvs_open(NS, NVS_READONLY, &handle) == ESP_OK) {
        nvs_get_u8(handle, key, &value);
        nvs_close(handle);
    }
    return value != 0;
}

void m2_save_channel(int channel, bool on)
{
    char key[12];
    snprintf(key, sizeof(key), "st%d", channel);
    nvs_handle_t handle;
    if (nvs_open(NS, NVS_READWRITE, &handle) != ESP_OK) return;
    // NVS spreads writes over its pages, so saving every change is fine for flash wear.
    if (nvs_set_u8(handle, key, on ? 1 : 0) == ESP_OK) nvs_commit(handle);
    nvs_close(handle);
}

esp_err_t m2_erase_all(void)
{
    nvs_flash_deinit();
    return nvs_flash_erase();
}
