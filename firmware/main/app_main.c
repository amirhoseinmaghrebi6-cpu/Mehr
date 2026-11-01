/*
 * M2smart board firmware (docs/board-protocol.md).
 *
 * Power-up order matters: the saved relay states are applied first (the lights come back as they
 * were, before there is any Wi-Fi), then the keys start, then Wi-Fi and the broker. Keys always
 * work, with or without internet.
 */
#include "board.h"
#include "channels.h"
#include "cloud.h"
#include "keys.h"
#include "led.h"
#include "net.h"
#include "ota.h"
#include "setup_mode.h"
#include "storage.h"
#include "esp_log.h"
#include "esp_system.h"

static const char *TAG = "m2";
static char uid[72], factory_secret[136];
static bool has_identity;

static void on_pairing(void)
{
    if (!has_identity) {
        ESP_LOGE(TAG, "No factory identity: this board was never provisioned (firmware/README.md)");
        return;
    }
    m2_setup_start(uid, factory_secret);
}

static void on_factory_reset(void)
{
    m2_cloud_say_reset();
    m2_erase_all();
    esp_restart();
}

void app_main(void)
{
    ESP_ERROR_CHECK(m2_storage_init());
    m2_channels_init();
    m2_led_init();
    m2_channels_listen(m2_cloud_report);
    m2_keys_start(on_pairing, on_factory_reset);

    has_identity = m2_factory_identity(uid, sizeof(uid), factory_secret, sizeof(factory_secret));
    // Logging the marker also keeps it in the image, where the server looks for it.
    ESP_LOGI(TAG, "Board %s, %s", has_identity ? uid : "(not provisioned)", m2_model_marker);
    m2_ota_boot_check();

    m2_net_init();
    char ssid[33], password[65];
    if (m2_load_wifi(ssid, sizeof(ssid), password, sizeof(password))) m2_net_connect(ssid, password);

    char board_id[64], broker_secret[96];
    if (m2_load_account(board_id, sizeof(board_id), broker_secret, sizeof(broker_secret))) {
        // The broker client waits for Wi-Fi and keeps reconnecting by itself.
        m2_cloud_start(board_id, broker_secret);
    } else {
        ESP_LOGI(TAG, "Not paired yet: hold the setup key 7-10 s, then let go");
    }
}
