/*
 * Runs main/channels.c on a PC against stubbed GPIOs and timers, once per motor board
 * (firmware/test/run.sh). Every relay change is checked: a motor's two relays are never on together.
 */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "board.h"
#include "channels.h"
#include "storage.h"
#include "driver/gpio.h"
#include "esp_timer.h"

static int level[48];
static int saved[20];
/** The relay pairs that must never be on together on this board. */
static int pair_a = -1, pair_b = -1;

int gpio_config(const gpio_config_t *config) { (void)config; return 0; }
int gpio_set_level(int gpio, uint32_t value)
{
    level[gpio] = value;
    if (pair_a >= 0) assert(!(level[pair_a] && level[pair_b]));
    return 0;
}
int gpio_get_level(int gpio) { return level[gpio]; }

struct stub_timer { esp_timer_cb_t callback; void *arg; bool running; };
static struct stub_timer timers[8];
static int timer_count;
int esp_timer_create(const esp_timer_create_args_t *args, esp_timer_handle_t *out)
{
    timers[timer_count] = (struct stub_timer){ args->callback, args->arg, false };
    *out = &timers[timer_count++];
    return 0;
}
int esp_timer_start_once(esp_timer_handle_t timer, uint64_t us) { (void)us; timer->running = true; return 0; }
int esp_timer_stop(esp_timer_handle_t timer) { timer->running = false; return 0; }
/** The timer runs out. */
static void elapse(void)
{
    for (int i = 0; i < timer_count; i++) {
        if (timers[i].running) {
            timers[i].running = false;
            timers[i].callback(timers[i].arg);
        }
    }
}

uint8_t m2_load_channel(int channel) { return saved[channel]; }
void m2_save_channel(int channel, uint8_t value) { saved[channel] = value; }

static int reports;
static char last_id[40];
static void on_report(int channel, const char *command_id)
{
    (void)channel;
    reports++;
    strcpy(last_id, command_id ? command_id : "");
}

static void poll(int times)
{
    for (int i = 0; i < times; i++) m2_channels_poll();
}

int main(void)
{
    const m2_channel_t *ch = &m2_board.channels[0];
    m2_channels_listen(on_report);
#if CONFIG_M2_BOARD_FN
    pair_a = 4, pair_b = 5;
    saved[0] = 2;  // high before the power cut
    m2_channels_init();
    assert(m2_channel_value(0) == 2 && level[5] && !level[4]);
    m2_channel_key(0, false, true);  // high → off
    assert(m2_channel_value(0) == 0 && !level[4] && !level[5]);
    m2_channel_key(0, false, true);  // → low
    m2_channel_key(0, false, true);  // → high
    assert(m2_channel_value(0) == 2 && level[5] && !level[4] && saved[0] == 2);
    m2_channel_command(0, false, 1, "c1");
    assert(level[4] && !level[5] && !strcmp(last_id, "c1"));
#elif CONFIG_M2_BOARD_CL
    pair_a = 5, pair_b = 6;
    saved[0] = 0x10 | 1;  // pump on, low
    m2_channels_init();
    assert(m2_channel_pump(0) && level[4] && m2_channel_value(0) == 1 && level[5]);
    m2_channel_command(0, false, 2, "c1");
    assert(level[6] && !level[5] && level[4]);
    m2_channel_command(0, true, 0, "c2");
    assert(!level[4] && level[6] && saved[0] == 2 && !strcmp(last_id, "c2"));
#elif CONFIG_M2_BOARD_CU
    pair_a = 4, pair_b = 5;
    saved[0] = 0;  // closed
    m2_channels_init();
    assert(!level[4] && !level[5]);  // never moves by itself after a power cut
    m2_channel_command(0, false, 1, "open1");
    assert(level[4] && reports == 0);  // reports only once there
    m2_channel_key(0, true, true);  // the "close" key reverses it; the command is overtaken
    assert(level[5] && !level[4]);
    elapse();
    assert(!level[4] && !level[5] && m2_channel_value(0) == 0 && reports == 1 && !strcmp(last_id, ""));
    m2_channel_command(0, false, 1, "open2");
    elapse();
    assert(m2_channel_value(0) == 1 && saved[0] == 1 && !strcmp(last_id, "open2"));
#elif CONFIG_M2_BOARD_GD
    level[ch->sensor_gpio] = 0;  // contact closed: the door is closed
    m2_channels_init();
    assert(m2_channel_value(0) == 0);
    m2_channel_command(0, false, 0, "shut");  // already closed: done at once, no pulse
    assert(!level[4] && !strcmp(last_id, "shut"));
    m2_channel_command(0, false, 1, "open");
    assert(level[4] && reports == 1);
    elapse();  // the pulse ends; the door has not moved yet
    assert(!level[4] && reports == 1);
    level[ch->sensor_gpio] = 1;  // the door leaves the contact
    poll(2);
    assert(reports == 1);  // not yet: the contact must agree 3 times
    poll(1);
    assert(m2_channel_value(0) == 1 && reports == 2 && !strcmp(last_id, "open"));
    level[ch->sensor_gpio] = 0;  // closed by its own remote: a report of its own
    poll(3);
    assert(m2_channel_value(0) == 0 && reports == 3 && !strcmp(last_id, ""));
#else
#error "channels_test covers fn, cl, cu, gd"
#endif
    printf("%s: ok\n", m2_board.model);
    return 0;
}
