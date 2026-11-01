#include "keys.h"
#include "board.h"
#include "channels.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

#define POLL_MS 20
#define PAIRING_FROM_MS 7000
#define PAIRING_TO_MS 10000
#define RESET_AFTER_MS 15000
/** A factory reset is possible only this long after power-up (turn the breaker off and on first). */
#define RESET_WINDOW_US (3LL * 60 * 1000 * 1000)

static const char *TAG = "keys";
static m2_key_action_t pairing_action;
static m2_key_action_t reset_action;

static bool pressed(int gpio)
{
#if CONFIG_M2_KEYS_BUTTON
    return gpio_get_level(gpio) == 0;
#else
    return gpio_get_level(gpio) == 1;
#endif
}

static void configure(int gpio)
{
    gpio_config_t in = { .pin_bit_mask = 1ULL << gpio, .mode = GPIO_MODE_INPUT };
#if CONFIG_M2_KEYS_BUTTON
    in.pull_up_en = GPIO_PULLUP_ENABLE;
#else
    // TTP223 drives its output; a pull-down keeps a missing module from reading as a touch.
    in.pull_down_en = GPIO_PULLDOWN_ENABLE;
#endif
    gpio_config(&in);
}

/** The channel a key switches (the setup key may switch one too), or -1. */
static int channel_of(int gpio)
{
    for (int i = 0; i < m2_board.channel_count; i++) {
        if (m2_board.channels[i].key_gpio == gpio) return i;
    }
    return -1;
}

typedef struct {
    int gpio;
    int channel;
    bool setup;
    bool down;
    int stable;     // consecutive samples that disagree with `down` (debounce)
    int64_t since;  // when it went down, µs
    bool reset_done;
} key_state_t;

static void watch(void *arg)
{
    key_state_t keys[24];
    int count = 0;
    for (int i = 0; i < m2_board.channel_count && count < 23; i++) {
        int gpio = m2_board.channels[i].key_gpio;
        if (gpio < 0) continue;
        keys[count++] = (key_state_t){ .gpio = gpio, .channel = i, .setup = gpio == m2_board.setup_gpio };
    }
    if (channel_of(m2_board.setup_gpio) < 0) keys[count++] = (key_state_t){ .gpio = m2_board.setup_gpio, .channel = -1, .setup = true };
    for (int i = 0; i < count; i++) configure(keys[i].gpio);

    for (;;) {
        int64_t now = esp_timer_get_time();
        for (int i = 0; i < count; i++) {
            key_state_t *key = &keys[i];
            bool level = pressed(key->gpio);
            key->stable = level != key->down ? key->stable + 1 : 0;
            if (key->stable >= 2) {
                key->down = level;
                key->stable = 0;
                const m2_channel_t *ch = key->channel >= 0 ? &m2_board.channels[key->channel] : NULL;
                if (key->down) {
                    key->since = now;
                    key->reset_done = false;
                    // A touch switches at once; a momentary channel is on while held.
                    if (ch && ch->kind == M2_CH_SWITCH) m2_channel_toggle(key->channel);
                    if (ch && ch->kind == M2_CH_MOMENTARY) m2_channel_set(key->channel, true, NULL);
                } else {
                    if (ch && ch->kind == M2_CH_MOMENTARY) m2_channel_set(key->channel, false, NULL);
                    int64_t held_ms = (now - key->since) / 1000;
                    if (key->setup && held_ms >= PAIRING_FROM_MS && held_ms < PAIRING_TO_MS) {
                        ESP_LOGI(TAG, "Setup key held %lld ms: pairing mode", held_ms);
                        m2_channel_blink(key->channel >= 0 ? key->channel : 0, 2);
                        if (pairing_action) pairing_action();
                    }
                }
            }
            // Over 15 s, and only within 3 minutes after power-up: factory reset.
            if (key->setup && key->down && !key->reset_done && (now - key->since) / 1000 >= RESET_AFTER_MS) {
                key->reset_done = true;
                if (now < RESET_WINDOW_US) {
                    ESP_LOGW(TAG, "Setup key held over 15 s after power-up: factory reset");
                    m2_channel_blink(key->channel >= 0 ? key->channel : 0, 3);
                    if (reset_action) reset_action();
                } else {
                    ESP_LOGI(TAG, "Factory reset ignored: only within 3 minutes after power-up");
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
    }
}

void m2_keys_start(m2_key_action_t on_pairing, m2_key_action_t on_factory_reset)
{
    pairing_action = on_pairing;
    reset_action = on_factory_reset;
    xTaskCreate(watch, "keys", 4096, NULL, 5, NULL);
}
