#include "led.h"
#include "board.h"
#include "channels.h"
#include "driver/gpio.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static esp_timer_handle_t blink_timer;
static bool lit;
static m2_led_mode_t current = M2_LED_OFF;

static void light(bool on)
{
    gpio_set_level(m2_board.status_led_gpio, on != m2_board.status_led_active_low);
}

static void toggle(void *arg)
{
    lit = !lit;
    light(lit);
}

void m2_led_init(void)
{
    if (m2_board.status_led_gpio < 0) return;
    gpio_config_t out = { .pin_bit_mask = 1ULL << m2_board.status_led_gpio, .mode = GPIO_MODE_OUTPUT };
    gpio_config(&out);
    light(0);
    esp_timer_create_args_t args = { .callback = toggle, .name = "led" };
    esp_timer_create(&args, &blink_timer);
}

void m2_led_set(m2_led_mode_t mode)
{
    if (m2_board.status_led_gpio < 0 || mode == current) return;
    current = mode;
    esp_timer_stop(blink_timer);
    if (mode == M2_LED_BLINK) {
        esp_timer_start_periodic(blink_timer, 500 * 1000);
    } else {
        lit = mode == M2_LED_ON;
        light(lit);
    }
}

/** The light that may blink for feedback: the setup key's own switch channel, never a strike or a pump. */
static int feedback_channel(void)
{
    for (int i = 0; i < m2_board.channel_count; i++) {
        const m2_channel_t *ch = &m2_board.channels[i];
        if (ch->key_gpio == m2_board.setup_gpio) return ch->kind == M2_CH_SWITCH && ch->inhibit_gpio < 0 ? i : -1;
    }
    return -1;
}

void m2_feedback(int times)
{
    if (m2_board.status_led_gpio >= 0) {
        m2_led_mode_t before = current;
        esp_timer_stop(blink_timer);
        for (int i = 0; i < times; i++) {
            light(1);
            vTaskDelay(pdMS_TO_TICKS(250));
            light(0);
            vTaskDelay(pdMS_TO_TICKS(250));
        }
        current = M2_LED_OFF;
        m2_led_set(before);
        return;
    }
    int channel = feedback_channel();
    if (channel >= 0) m2_channel_blink(channel, times);
}
