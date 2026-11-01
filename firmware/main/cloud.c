#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cloud.h"
#include "board.h"
#include "channels.h"
#include "storage.h"
#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "mqtt_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

static const char *TAG = "cloud";
extern const char board_ca_pem_start[] asm("_binary_board_ca_pem_start");

static esp_mqtt_client_handle_t client;
static bool connected;
static char topic_base[96];
static int refused;

static void topic(char *out, size_t len, const char *kind)
{
    snprintf(out, len, "%s/%s", topic_base, kind);
}

static void publish(const char *kind, cJSON *json, bool retain)
{
    if (!client) return;
    char name[128];
    topic(name, sizeof(name), kind);
    char *text = cJSON_PrintUnformatted(json);
    esp_mqtt_client_publish(client, name, text, 0, 1, retain);
    free(text);
}

static void add_value(cJSON *values, int channel, bool on)
{
    const m2_channel_t *ch = &m2_board.channels[channel];
    cJSON *value = cJSON_CreateObject();
    cJSON_AddStringToObject(value, "ch", ch->key);
    cJSON_AddStringToObject(value, "cap", ch->capability);
    if (ch->kind == M2_CH_MOMENTARY) cJSON_AddStringToObject(value, "val", "open");
    else cJSON_AddBoolToObject(value, "val", on);
    cJSON_AddItemToArray(values, value);
}

/** Every switch channel, on connect: the server learns the real state (a wall key may have been used offline). */
static void report_all(void)
{
    cJSON *json = cJSON_CreateObject();
    cJSON *values = cJSON_AddArrayToObject(json, "values");
    for (int i = 0; i < m2_board.channel_count; i++) {
        if (m2_board.channels[i].kind == M2_CH_SWITCH) add_value(values, i, m2_channel_is_on(i));
    }
    if (cJSON_GetArraySize(values)) publish("state", json, false);
    cJSON_Delete(json);
}

void m2_cloud_report(int channel, bool on, const char *command_id)
{
    if (!connected) return;
    // A momentary channel reports only that it opened, with its command.
    if (m2_board.channels[channel].kind == M2_CH_MOMENTARY && !on) return;
    cJSON *json = cJSON_CreateObject();
    if (command_id) cJSON_AddStringToObject(json, "id", command_id);
    add_value(cJSON_AddArrayToObject(json, "values"), channel, on);
    publish("state", json, false);
    cJSON_Delete(json);
}

static void ack(const char *id, const char *err)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "id", id);
    if (err) cJSON_AddStringToObject(json, "err", err);
    publish("ack", json, false);
    cJSON_Delete(json);
}

/** server → board: {"id", "ch", "cap", "val", "ttl"} (packages/contracts/src/board-protocol.ts). */
static void on_command(const char *data, int len)
{
    cJSON *json = cJSON_ParseWithLength(data, len);
    const cJSON *id = cJSON_GetObjectItem(json, "id");
    const cJSON *ch = cJSON_GetObjectItem(json, "ch");
    const cJSON *cap = cJSON_GetObjectItem(json, "cap");
    const cJSON *val = cJSON_GetObjectItem(json, "val");
    if (!cJSON_IsString(id) || !cJSON_IsString(ch) || !cJSON_IsString(cap) || !val) {
        ESP_LOGW(TAG, "Ignored a malformed command");
        cJSON_Delete(json);
        return;
    }
    int channel = m2_board_channel(ch->valuestring);
    const m2_channel_t *target = channel >= 0 ? &m2_board.channels[channel] : NULL;
    if (!target || strcmp(target->capability, cap->valuestring) != 0) {
        ack(id->valuestring, "unknown_target");
    } else if (target->kind == M2_CH_SWITCH && cJSON_IsBool(val)) {
        ack(id->valuestring, NULL);
        m2_channel_set(channel, cJSON_IsTrue(val), id->valuestring);
    } else if (target->kind == M2_CH_MOMENTARY && cJSON_IsString(val) && strcmp(val->valuestring, "open") == 0) {
        ack(id->valuestring, NULL);
        m2_channel_pulse(channel, target->pulse_ms > 0 ? target->pulse_ms : 5000, id->valuestring);
    } else {
        ack(id->valuestring, "bad_value");
    }
    cJSON_Delete(json);
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    esp_mqtt_event_handle_t event = data;
    char name[128];
    switch ((esp_mqtt_event_id_t)id) {
    case MQTT_EVENT_CONNECTED: {
        connected = true;
        refused = 0;
        ESP_LOGI(TAG, "Connected to the broker");
        topic(name, sizeof(name), "cmd");
        esp_mqtt_client_subscribe(client, name, 1);
        cJSON *status = cJSON_CreateObject();
        cJSON_AddBoolToObject(status, "online", true);
        cJSON_AddStringToObject(status, "fw", esp_app_get_description()->version);
        publish("status", status, true);
        cJSON_Delete(status);
        report_all();
        break;
    }
    case MQTT_EVENT_DISCONNECTED:
        connected = false;
        break;
    case MQTT_EVENT_DATA:
        topic(name, sizeof(name), "cmd");
        if (event->topic_len == (int)strlen(name) && strncmp(event->topic, name, event->topic_len) == 0) on_command(event->data, event->data_len);
        break;
    case MQTT_EVENT_ERROR:
        // Refused login: the board was removed in the app or reset on the server. It keeps obeying
        // its keys and waits for the setup key; asking again and again is pointless.
        if (event->error_handle->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED && ++refused >= 5) {
            ESP_LOGW(TAG, "The broker refuses this board: it is no longer paired. Hold the setup key to pair it again.");
            esp_mqtt_client_stop(client);
        }
        break;
    default:
        break;
    }
}

void m2_cloud_start(const char *board_id, const char *broker_secret)
{
    snprintf(topic_base, sizeof(topic_base), "m2/v1/boards/%s", board_id);
    char will_topic[128];
    topic(will_topic, sizeof(will_topic), "status");
    static char will_topic_kept[128];
    strlcpy(will_topic_kept, will_topic, sizeof(will_topic_kept));
    static char id_kept[64], secret_kept[96];
    strlcpy(id_kept, board_id, sizeof(id_kept));
    strlcpy(secret_kept, broker_secret, sizeof(secret_kept));

    esp_mqtt_client_config_t config = {
        .broker.address.uri = CONFIG_M2_MQTT_URL,
        // Our own certificate authority: only our broker is trusted, never a public one.
        .broker.verification.certificate = board_ca_pem_start,
        .credentials.username = id_kept,
        .credentials.client_id = id_kept,
        .credentials.authentication.password = secret_kept,
        .session.keepalive = 30,
        .session.last_will = { .topic = will_topic_kept, .msg = "{\"online\":false}", .qos = 1, .retain = 1 },
        .network.reconnect_timeout_ms = 5000,
    };
#if !CONFIG_M2_DEV_INSECURE
    if (strncmp(CONFIG_M2_MQTT_URL, "mqtts://", 8) != 0) {
        ESP_LOGE(TAG, "The broker address must be mqtts://");
        return;
    }
#endif
    client = esp_mqtt_client_init(&config);
    esp_mqtt_client_register_event(client, ESP_EVENT_ANY_ID, on_event, NULL);
    esp_mqtt_client_start(client);
}

bool m2_cloud_connected(void)
{
    return connected;
}

void m2_cloud_say_reset(void)
{
    if (!connected) return;
    cJSON *json = cJSON_CreateObject();
    publish("reset", json, false);
    cJSON_Delete(json);
    // Give the message a moment to leave before the board erases itself.
    vTaskDelay(pdMS_TO_TICKS(1000));
}
