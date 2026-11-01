#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "cloud.h"
#include "board.h"
#include "channels.h"
#include "led.h"
#include "measure.h"
#include "ota.h"
#include "storage.h"
#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "mqtt_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

static const char *TAG = "cloud";
extern const char board_ca_pem_start[] asm("_binary_board_ca_pem_start");

static esp_mqtt_client_handle_t client;
/** Every value again every 10 minutes, so the server knows a quiet sensor is still there. */
static esp_timer_handle_t heartbeat;
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

static const char *SPEEDS[] = { "off", "low", "high" };
/** Curtains and parking doors. */
static const char *POSITIONS[] = { "closed", "open" };

static cJSON *value_item(cJSON *values, const char *channel_key, const char *cap)
{
    cJSON *value = cJSON_CreateObject();
    cJSON_AddStringToObject(value, "ch", channel_key);
    cJSON_AddStringToObject(value, "cap", cap);
    cJSON_AddItemToArray(values, value);
    return value;
}

/** A channel's capabilities and values, as the device catalog names them. */
static void add_values(cJSON *values, int channel)
{
    const m2_channel_t *ch = &m2_board.channels[channel];
    if (ch->kind == M2_CH_MEASURE) {
        // Only what was really measured, to one decimal.
        float measured;
        if (m2_measure_value(channel, false, &measured)) cJSON_AddNumberToObject(value_item(values, ch->key, ch->capability), "val", roundf(measured * 10) / 10);
        if (ch->capability2 && m2_measure_value(channel, true, &measured)) cJSON_AddNumberToObject(value_item(values, ch->key, ch->capability2), "val", roundf(measured * 10) / 10);
        return;
    }
    int value = m2_channel_value(channel);
    cJSON *item = value_item(values, ch->key, ch->capability);
    switch (ch->kind) {
    case M2_CH_SWITCH: cJSON_AddBoolToObject(item, "val", value); break;
    case M2_CH_MOMENTARY: cJSON_AddStringToObject(item, "val", "open"); break;
    case M2_CH_FAN:
    case M2_CH_COOLER: cJSON_AddStringToObject(item, "val", SPEEDS[value]); break;
    case M2_CH_CURTAIN:
    case M2_CH_GARAGE: cJSON_AddStringToObject(item, "val", POSITIONS[value]); break;
    case M2_CH_DIMMER: cJSON_AddNumberToObject(item, "val", value); break;
    case M2_CH_MEASURE: break;
    case M2_CH_INPUT:
        if (strcmp(ch->capability, "contact") == 0) cJSON_AddStringToObject(item, "val", POSITIONS[value]);
        else cJSON_AddBoolToObject(item, "val", value);
        break;
    }
    if (ch->kind == M2_CH_COOLER) cJSON_AddBoolToObject(value_item(values, ch->key, "pump"), "val", m2_channel_pump(channel));
}

/** The index of `text` in `names`, or -1. */
static int find(const char *text, const char *const *names, int count)
{
    for (int i = 0; i < count; i++) {
        if (strcmp(text, names[i]) == 0) return i;
    }
    return -1;
}

/** A command's value as channels.c counts it (channels.h), or -1 if it does not fit. */
static int decode(const m2_channel_t *ch, bool pump, const cJSON *val)
{
    if (ch->kind == M2_CH_SWITCH || pump) return cJSON_IsBool(val) ? cJSON_IsTrue(val) : -1;
    if (ch->kind == M2_CH_DIMMER) {
        // A whole percentage, 0–100.
        if (!cJSON_IsNumber(val) || val->valuedouble != (int)val->valuedouble) return -1;
        return val->valueint >= 0 && val->valueint <= 100 ? val->valueint : -1;
    }
    if (!cJSON_IsString(val)) return -1;
    switch (ch->kind) {
    case M2_CH_MOMENTARY: return strcmp(val->valuestring, "open") == 0 ? 1 : -1;
    case M2_CH_FAN:
    case M2_CH_COOLER: return find(val->valuestring, SPEEDS, 3);
    default: return find(val->valuestring, POSITIONS, 2);
    }
}

/** Every channel but a strike, on connect: the server learns the real state (a wall key may have been used offline). */
static void report_all(void)
{
    cJSON *json = cJSON_CreateObject();
    cJSON *values = cJSON_AddArrayToObject(json, "values");
    for (int i = 0; i < m2_board.channel_count; i++) {
        if (m2_board.channels[i].kind != M2_CH_MOMENTARY) add_values(values, i);
    }
    if (cJSON_GetArraySize(values)) publish("state", json, false);
    cJSON_Delete(json);
}

static void report_all_now(void *arg)
{
    if (connected) report_all();
}

void m2_cloud_report(int channel, const char *command_id)
{
    if (!connected) return;
    // A momentary channel reports only that it opened.
    if (m2_board.channels[channel].kind == M2_CH_MOMENTARY && !m2_channel_value(channel)) return;
    cJSON *json = cJSON_CreateObject();
    if (command_id) cJSON_AddStringToObject(json, "id", command_id);
    add_values(cJSON_AddArrayToObject(json, "values"), channel);
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
    // A cooler's second capability: its pump.
    bool pump = target && target->kind == M2_CH_COOLER && strcmp(cap->valuestring, "pump") == 0;
    int value = target ? decode(target, pump, val) : -1;
    // A sensor's values are read-only.
    if (!target || target->kind == M2_CH_INPUT || target->kind == M2_CH_MEASURE || (!pump && strcmp(target->capability, cap->valuestring) != 0)) {
        ack(id->valuestring, "unknown_target");
    } else if (value < 0) {
        ack(id->valuestring, "invalid_value");
    } else if (value && m2_channel_inhibited(channel)) {
        // e.g. a pump whose tank is empty: it must not run dry.
        ack(id->valuestring, "blocked_by_sensor");
    } else {
        ack(id->valuestring, NULL);
        m2_channel_command(channel, pump, value, id->valuestring);
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
        m2_led_set(M2_LED_ON);
        ESP_LOGI(TAG, "Connected to the broker");
        topic(name, sizeof(name), "cmd");
        esp_mqtt_client_subscribe(client, name, 1);
        topic(name, sizeof(name), "update");
        esp_mqtt_client_subscribe(client, name, 1);
        // Reaching the broker is what proves a new firmware works.
        m2_ota_confirm();
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
        m2_led_set(M2_LED_OFF);
        break;
    case MQTT_EVENT_DATA:
        topic(name, sizeof(name), "cmd");
        if (event->topic_len == (int)strlen(name) && strncmp(event->topic, name, event->topic_len) == 0) on_command(event->data, event->data_len);
        topic(name, sizeof(name), "update");
        if (event->topic_len == (int)strlen(name) && strncmp(event->topic, name, event->topic_len) == 0) m2_ota_offer(event->data, event->data_len);
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
    esp_timer_create_args_t beat = { .callback = report_all_now, .name = "heartbeat" };
    esp_timer_create(&beat, &heartbeat);
    esp_timer_start_periodic(heartbeat, 10LL * 60 * 1000 * 1000);
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
