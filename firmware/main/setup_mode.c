#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "setup_mode.h"
#include "claim.h"
#include "net.h"
#include "storage.h"
#include "cJSON.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define PAIRING_MINUTES 5

static const char *TAG = "setup";
extern const char page_start[] asm("_binary_setup_page_html_start");
extern const char page_end[] asm("_binary_setup_page_html_end");

typedef enum { IDLE, CONNECTING, WIFI_FAILED, CLAIMING, WRONG_CODE, WRONG_PRODUCT, TOO_MANY, NO_SERVER, DONE } setup_state_t;
static const char *STATE_NAMES[] = { "idle", "connecting", "wifi_failed", "claiming", "wrong_code", "wrong_product", "too_many", "no_server", "done" };

static httpd_handle_t server;
static esp_timer_handle_t timeout;
static volatile setup_state_t state = IDLE;
static char uid[72], factory_secret[136];
static char ssid[33], password[65], code[24];

static esp_err_t page(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, page_start, page_end - page_start - 1);
}

static esp_err_t scan(httpd_req_t *req)
{
    char json[1200];
    m2_net_scan_json(json, sizeof(json));
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, json);
}

static esp_err_t status(httpd_req_t *req)
{
    char json[48];
    snprintf(json, sizeof(json), "{\"state\":\"%s\"}", STATE_NAMES[state]);
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, json);
}

/** Joins the home Wi-Fi, then claims; on success the board keeps both and restarts paired. */
static void pair(void *arg)
{
    state = CONNECTING;
    m2_net_connect(ssid, password);
    if (!m2_net_wait_connected(20000)) {
        state = WIFI_FAILED;
        vTaskDelete(NULL);
        return;
    }
    state = CLAIMING;
    char board_id[64], broker_secret[96];
    m2_claim_result_t result = m2_claim(uid, factory_secret, code, board_id, sizeof(board_id), broker_secret, sizeof(broker_secret));
    if (result == M2_CLAIM_OK) {
        m2_save_wifi(ssid, password);
        m2_save_account(board_id, broker_secret);
        state = DONE;
        ESP_LOGI(TAG, "Paired as board %s; restarting", board_id);
        // Let the page show "paired" before the setup network goes away.
        vTaskDelay(pdMS_TO_TICKS(5000));
        esp_restart();
    }
    state = result == M2_CLAIM_WRONG_CODE ? WRONG_CODE : result == M2_CLAIM_WRONG_PRODUCT ? WRONG_PRODUCT : result == M2_CLAIM_TOO_MANY ? TOO_MANY : NO_SERVER;
    vTaskDelete(NULL);
}

static esp_err_t setup(httpd_req_t *req)
{
    char body[256] = { 0 };
    int read = httpd_req_recv(req, body, sizeof(body) - 1);
    cJSON *json = read > 0 ? cJSON_Parse(body) : NULL;
    const cJSON *s = cJSON_GetObjectItem(json, "ssid");
    const cJSON *p = cJSON_GetObjectItem(json, "password");
    const cJSON *c = cJSON_GetObjectItem(json, "code");
    bool busy = state == CONNECTING || state == CLAIMING || state == DONE;
    if (busy || !cJSON_IsString(s) || !s->valuestring[0] || !cJSON_IsString(c)) {
        cJSON_Delete(json);
        httpd_resp_set_status(req, busy ? "409 Conflict" : "400 Bad Request");
        return httpd_resp_sendstr(req, "{}");
    }
    strlcpy(ssid, s->valuestring, sizeof(ssid));
    strlcpy(password, cJSON_IsString(p) ? p->valuestring : "", sizeof(password));
    strlcpy(code, c->valuestring, sizeof(code));
    cJSON_Delete(json);
    xTaskCreate(pair, "pair", 8192, NULL, 5, NULL);
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, "{}");
}

static void time_up(void *arg)
{
    // Pairing mode ends after 5 minutes; if the board is pairing right now, a minute later.
    if (state == CONNECTING || state == CLAIMING || state == DONE) {
        esp_timer_start_once(timeout, 60ULL * 1000 * 1000);
        return;
    }
    ESP_LOGI(TAG, "Pairing mode ended");
    esp_restart();
}

void m2_setup_start(const char *board_uid, const char *secret)
{
    if (server) return;
    strlcpy(uid, board_uid, sizeof(uid));
    strlcpy(factory_secret, secret, sizeof(factory_secret));
    char name[33];
    size_t len = strlen(uid);
    // The network is named after the last 4 characters of the hardware id.
    snprintf(name, sizeof(name), "M2smart-%.4s", len > 4 ? uid + len - 4 : uid);
    m2_net_start_ap(name);

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 8192;
    ESP_ERROR_CHECK(httpd_start(&server, &config));
    const httpd_uri_t routes[] = {
        { .uri = "/", .method = HTTP_GET, .handler = page },
        { .uri = "/scan", .method = HTTP_GET, .handler = scan },
        { .uri = "/status", .method = HTTP_GET, .handler = status },
        { .uri = "/setup", .method = HTTP_POST, .handler = setup },
    };
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) httpd_register_uri_handler(server, &routes[i]);

    esp_timer_create_args_t args = { .callback = time_up, .name = "pairing" };
    esp_timer_create(&args, &timeout);
    esp_timer_start_once(timeout, (uint64_t)PAIRING_MINUTES * 60 * 1000 * 1000);
    ESP_LOGI(TAG, "Pairing mode for %d minutes: http://192.168.4.1", PAIRING_MINUTES);
}
