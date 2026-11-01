#include <stdio.h>
#include <string.h>
#include "net.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

#define CONNECTED_BIT BIT0

static const char *TAG = "net";
static EventGroupHandle_t events;
static bool joining;
static bool ap_on;

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START && joining) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(events, CONNECTED_BIT);
        // Keep trying: the router may restart later than the board after a power cut.
        if (joining) esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ESP_LOGI(TAG, "Joined the home network");
        xEventGroupSetBits(events, CONNECTED_BIT);
    }
}

void m2_net_init(void)
{
    events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();
    wifi_init_config_t config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&config));
    // The board keeps the home network in its own storage (erased by a factory reset), not Wi-Fi's.
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());
}

void m2_net_connect(const char *ssid, const char *password)
{
    wifi_config_t config = { 0 };
    strlcpy((char *)config.sta.ssid, ssid, sizeof(config.sta.ssid));
    strlcpy((char *)config.sta.password, password, sizeof(config.sta.password));
    config.sta.threshold.authmode = password[0] ? WIFI_AUTH_WPA_PSK : WIFI_AUTH_OPEN;
    joining = true;
    esp_wifi_disconnect();
    xEventGroupClearBits(events, CONNECTED_BIT);
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &config));
    esp_wifi_connect();
}

bool m2_net_wait_connected(int timeout_ms)
{
    return xEventGroupWaitBits(events, CONNECTED_BIT, pdFALSE, pdTRUE, pdMS_TO_TICKS(timeout_ms)) & CONNECTED_BIT;
}

bool m2_net_connected(void)
{
    return xEventGroupGetBits(events) & CONNECTED_BIT;
}

void m2_net_start_ap(const char *name)
{
    wifi_config_t config = { 0 };
    strlcpy((char *)config.ap.ssid, name, sizeof(config.ap.ssid));
    config.ap.ssid_len = strlen(name);
    config.ap.channel = 1;
    config.ap.max_connection = 2;
    // Open, like most devices' setup networks; it lasts only 5 minutes, after someone held the key.
    config.ap.authmode = WIFI_AUTH_OPEN;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &config));
    ap_on = true;
    ESP_LOGI(TAG, "Setup network %s is open", name);
}

void m2_net_stop_ap(void)
{
    if (!ap_on) return;
    esp_wifi_set_mode(WIFI_MODE_STA);
    ap_on = false;
}

void m2_net_scan_json(char *out, size_t len)
{
    wifi_scan_config_t scan = { 0 };
    uint16_t count = 20;
    wifi_ap_record_t records[20];
    size_t used = 0;
    used += snprintf(out + used, len - used, "[");
    if (esp_wifi_scan_start(&scan, true) == ESP_OK && esp_wifi_scan_get_ap_records(&count, records) == ESP_OK) {
        for (int i = 0; i < count && used + 40 < len; i++) {
            const char *name = (const char *)records[i].ssid;
            if (!name[0]) continue;
            // Names are written as JSON strings; quotes and backslashes are dropped.
            used += snprintf(out + used, len - used, "%s\"", used > 1 ? "," : "");
            for (const char *c = name; *c && used + 4 < len; c++) {
                if (*c != '"' && *c != '\\' && (unsigned char)*c >= 0x20) out[used++] = *c;
            }
            used += snprintf(out + used, len - used, "\"");
        }
    }
    snprintf(out + used, len - used, "]");
}
