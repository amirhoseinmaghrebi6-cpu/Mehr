#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "ota.h"
#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "mbedtls/sha256.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

#define CONFIRM_WITHIN_US (5LL * 60 * 1000 * 1000)

static const char *TAG = "ota";
static esp_timer_handle_t unproven_timer;
static volatile bool busy;

typedef struct {
    char version[32];
    char url[200];
    char sha256[65];
    int size;
} offer_t;

static void give_up(void *arg)
{
    ESP_LOGE(TAG, "The new firmware did not reach the broker in 5 minutes: going back to the previous one");
    esp_ota_mark_app_invalid_rollback_and_reboot();
}

void m2_ota_boot_check(void)
{
    esp_ota_img_states_t state;
    if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) != ESP_OK || state != ESP_OTA_IMG_PENDING_VERIFY) return;
    ESP_LOGW(TAG, "Running a new firmware (%s): it must reach the broker within 5 minutes", esp_app_get_description()->version);
    esp_timer_create_args_t args = { .callback = give_up, .name = "ota-check" };
    esp_timer_create(&args, &unproven_timer);
    esp_timer_start_once(unproven_timer, CONFIRM_WITHIN_US);
}

void m2_ota_confirm(void)
{
    if (!unproven_timer) return;
    esp_timer_stop(unproven_timer);
    esp_ota_mark_app_valid_cancel_rollback();
    unproven_timer = NULL;
    ESP_LOGI(TAG, "The new firmware works: kept");
}

static void to_hex(const unsigned char *digest, char *out)
{
    for (int i = 0; i < 32; i++) sprintf(out + i * 2, "%02x", digest[i]);
}

/** Downloads, checks and installs; restarts on success. */
static void install(void *arg)
{
    offer_t *offer = arg;
    ESP_LOGI(TAG, "Updating to %s from %s", offer->version, offer->url);
    const esp_partition_t *slot = esp_ota_get_next_update_partition(NULL);
    esp_ota_handle_t handle = 0;
    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts(&sha, 0);
    bool ok = false;

    esp_http_client_config_t config = { .url = offer->url, .timeout_ms = 20000, .crt_bundle_attach = esp_crt_bundle_attach, .buffer_size = 2048 };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    char *chunk = malloc(2048);
    if (chunk && slot && esp_http_client_open(client, 0) == ESP_OK && esp_http_client_fetch_headers(client) >= 0 && esp_http_client_get_status_code(client) == 200
        && esp_ota_begin(slot, offer->size, &handle) == ESP_OK) {
        int total = 0;
        for (;;) {
            int read = esp_http_client_read(client, chunk, 2048);
            if (read < 0) break;
            if (read == 0) {
                ok = esp_http_client_is_complete_data_received(client);
                break;
            }
            mbedtls_sha256_update(&sha, (const unsigned char *)chunk, read);
            if (esp_ota_write(handle, chunk, read) != ESP_OK) break;
            total += read;
        }
        if (ok && total != offer->size) ok = false;
        unsigned char digest[32];
        char hex[65];
        mbedtls_sha256_finish(&sha, digest);
        to_hex(digest, hex);
        // The image must be exactly the one the server announced over the broker.
        if (ok && strcmp(hex, offer->sha256) != 0) {
            ESP_LOGE(TAG, "SHA-256 does not match: refused");
            ok = false;
        }
        // esp_ota_end checks the image itself (format and its own checksum) too.
        if (ok) ok = esp_ota_end(handle) == ESP_OK && esp_ota_set_boot_partition(slot) == ESP_OK;
        else esp_ota_abort(handle);
    }
    free(chunk);
    mbedtls_sha256_free(&sha);
    esp_http_client_cleanup(client);
    if (ok) {
        ESP_LOGI(TAG, "Firmware %s installed: restarting", offer->version);
        free(offer);
        esp_restart();
    }
    ESP_LOGE(TAG, "Update to %s failed; the server offers it again when the board reconnects", offer->version);
    free(offer);
    busy = false;
    vTaskDelete(NULL);
}

void m2_ota_offer(const char *data, int len)
{
    cJSON *json = cJSON_ParseWithLength(data, len);
    const cJSON *version = cJSON_GetObjectItem(json, "version");
    const cJSON *path = cJSON_GetObjectItem(json, "path");
    const cJSON *sha = cJSON_GetObjectItem(json, "sha256");
    const cJSON *size = cJSON_GetObjectItem(json, "size");
    bool valid = cJSON_IsString(version) && cJSON_IsString(path) && cJSON_IsString(sha) && cJSON_IsNumber(size)
        && strncmp(path->valuestring, "/api/v1/firmware/", 17) == 0 && strlen(sha->valuestring) == 64 && size->valueint > 0;
    if (!valid || busy || strcmp(version->valuestring, esp_app_get_description()->version) == 0) {
        cJSON_Delete(json);
        return;
    }
    offer_t *offer = calloc(1, sizeof(offer_t));
    strlcpy(offer->version, version->valuestring, sizeof(offer->version));
    snprintf(offer->url, sizeof(offer->url), "%s%s", CONFIG_M2_API_URL, path->valuestring);
    strlcpy(offer->sha256, sha->valuestring, sizeof(offer->sha256));
    offer->size = size->valueint;
    cJSON_Delete(json);
    busy = true;
    xTaskCreate(install, "ota", 8192, offer, 4, NULL);
}
