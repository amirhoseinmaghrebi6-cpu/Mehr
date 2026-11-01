#include "channels.h"
#include "board.h"
#include "storage.h"
#include "driver/gpio.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define MAX_CHANNELS 20

static bool state[MAX_CHANNELS];
static esp_timer_handle_t pulse_timers[MAX_CHANNELS];
static m2_channel_listener_t listener;

static void drive(int channel, bool on)
{
    gpio_set_level(m2_board.channels[channel].relay_gpio, on == m2_board.relay_active_high ? 1 : 0);
}

static void pulse_done(void *arg)
{
    int channel = (int)(intptr_t)arg;
    state[channel] = false;
    drive(channel, false);
    if (listener) listener(channel, false, NULL);
}

void m2_channels_init(void)
{
    for (int i = 0; i < m2_board.channel_count && i < MAX_CHANNELS; i++) {
        const m2_channel_t *ch = &m2_board.channels[i];
        gpio_config_t out = { .pin_bit_mask = 1ULL << ch->relay_gpio, .mode = GPIO_MODE_OUTPUT };
        gpio_config(&out);
        // A momentary channel never comes back on after a power cut.
        state[i] = ch->kind == M2_CH_SWITCH && m2_load_channel(i);
        drive(i, state[i]);
        if (ch->kind == M2_CH_MOMENTARY) {
            esp_timer_create_args_t args = { .callback = pulse_done, .arg = (void *)(intptr_t)i, .name = "pulse" };
            esp_timer_create(&args, &pulse_timers[i]);
        }
    }
}

void m2_channels_listen(m2_channel_listener_t fn)
{
    listener = fn;
}

bool m2_channel_is_on(int channel)
{
    return state[channel];
}

void m2_channel_set(int channel, bool on, const char *command_id)
{
    if (channel < 0 || channel >= m2_board.channel_count) return;
    state[channel] = on;
    drive(channel, on);
    if (m2_board.channels[channel].kind == M2_CH_SWITCH) m2_save_channel(channel, on);
    if (listener) listener(channel, on, command_id);
}

void m2_channel_toggle(int channel)
{
    m2_channel_set(channel, !state[channel], NULL);
}

void m2_channel_pulse(int channel, int ms, const char *command_id)
{
    if (channel < 0 || channel >= m2_board.channel_count || !pulse_timers[channel]) return;
    esp_timer_stop(pulse_timers[channel]);
    state[channel] = true;
    drive(channel, true);
    if (listener) listener(channel, true, command_id);
    esp_timer_start_once(pulse_timers[channel], (uint64_t)ms * 1000);
}

void m2_channel_blink(int channel, int times)
{
    if (channel < 0 || channel >= m2_board.channel_count) return;
    for (int i = 0; i < times; i++) {
        drive(channel, !state[channel]);
        vTaskDelay(pdMS_TO_TICKS(250));
        drive(channel, state[channel]);
        vTaskDelay(pdMS_TO_TICKS(250));
    }
}
