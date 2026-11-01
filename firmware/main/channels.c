#include <string.h>
#include "channels.h"
#include "board.h"
#include "storage.h"
#include "dimmer.h"
#include "driver/gpio.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#define MAX_CHANNELS 20
/** A motor's relay is off this long before another of its relays comes on (speed change, reversing). */
#define MOTOR_PAUSE_MS 300
/** A curtain motor stops this long before it runs the other way. */
#define REVERSE_PAUSE_MS 600
/** Samples (20 ms apart) a door contact must agree on before it counts. */
#define CONTACT_SAMPLES 3

static int value[MAX_CHANNELS];
static bool pump[MAX_CHANNELS];
/** Curtains: moving towards `target` until the timer ends. Doors: `target` is what the command asked. */
static bool moving[MAX_CHANNELS];
static int target[MAX_CHANNELS];
/** The command a curtain or door reports when it gets there. */
static char pending[MAX_CHANNELS][40];
static int contact_count[MAX_CHANNELS];
/** Dimmers: the brightness a touch switches back on to. */
static int last_on[MAX_CHANNELS];
static esp_timer_handle_t timers[MAX_CHANNELS];
static m2_channel_listener_t listener;
/** Keys, commands and timers run on different tasks; a motor's relays change under this lock only. */
static SemaphoreHandle_t lock;
/**
 * Reports wait here until the lock is let go: sending takes the MQTT client's own lock, which the
 * MQTT task holds while it hands us a command, so sending under ours could deadlock.
 */
static struct { int channel; char id[40]; } outbox[MAX_CHANNELS];
static int outbox_count;

static void relay(int gpio, bool on)
{
    gpio_set_level(gpio, on == m2_board.relay_active_high ? 1 : 0);
}

static void output(int gpio)
{
    gpio_config_t out = { .pin_bit_mask = 1ULL << gpio, .mode = GPIO_MODE_OUTPUT };
    gpio_config(&out);
    relay(gpio, false);
}

/** Contacts to GND get a pull-up; sensors that drive their pin, a pull-down. */
static void input(int gpio, bool driven)
{
    gpio_config_t in = { .pin_bit_mask = 1ULL << gpio, .mode = GPIO_MODE_INPUT };
    if (driven) in.pull_down_en = GPIO_PULLDOWN_ENABLE;
    else in.pull_up_en = GPIO_PULLUP_ENABLE;
    gpio_config(&in);
}

static void report(int channel, const char *command_id)
{
    if (outbox_count == MAX_CHANNELS) return;
    outbox[outbox_count].channel = channel;
    strlcpy(outbox[outbox_count].id, command_id ? command_id : "", sizeof(outbox[0].id));
    outbox_count++;
}

static void take(void)
{
    xSemaphoreTake(lock, portMAX_DELAY);
}

/** Lets go of the lock, then sends what was reported under it. */
static void give(void)
{
    int count = outbox_count;
    int channels[MAX_CHANNELS];
    char ids[MAX_CHANNELS][40];
    for (int i = 0; i < count; i++) {
        channels[i] = outbox[i].channel;
        strlcpy(ids[i], outbox[i].id, sizeof(ids[i]));
    }
    outbox_count = 0;
    xSemaphoreGive(lock);
    for (int i = 0; i < count; i++) {
        if (listener) listener(channels[i], ids[i][0] ? ids[i] : NULL);
    }
}

/** Packs what a channel keeps over a power cut. */
static void save(int channel)
{
    m2_save_channel(channel, (uint8_t)(value[channel] | (pump[channel] ? 0x10 : 0)));
}

/** A parking door's contact (to GND, LOW = closed) or a sensor input: 1 = open or active. */
static int read_sensor(const m2_channel_t *ch)
{
    int high = gpio_get_level(ch->sensor_gpio) ? 1 : 0;
    return ch->kind == M2_CH_INPUT ? high == (ch->sensor_active_high ? 1 : 0) : high;
}

/** Fan and cooler: break before make, so the motor never gets both windings. */
static void drive_speed(int channel, int speed)
{
    const m2_channel_t *ch = &m2_board.channels[channel];
    int low = ch->kind == M2_CH_COOLER ? ch->relay2_gpio : ch->relay_gpio;
    int high = ch->kind == M2_CH_COOLER ? ch->relay3_gpio : ch->relay2_gpio;
    relay(low, false);
    relay(high, false);
    if (speed == 0) return;
    if (value[channel] != 0 && value[channel] != speed) vTaskDelay(pdMS_TO_TICKS(MOTOR_PAUSE_MS));
    relay(speed == 1 ? low : high, true);
}

static void timer_done(void *arg)
{
    int channel = (int)(intptr_t)arg;
    const m2_channel_t *ch = &m2_board.channels[channel];
    take();
    relay(ch->relay_gpio, false);
    if (ch->kind == M2_CH_MOMENTARY) {
        value[channel] = 0;
        report(channel, NULL);
    } else if (ch->kind == M2_CH_CURTAIN) {
        // The track's end: the motor's own end stop has halted it by now.
        relay(ch->relay2_gpio, false);
        moving[channel] = false;
        value[channel] = target[channel];
        save(channel);
        report(channel, pending[channel][0] ? pending[channel] : NULL);
        pending[channel][0] = '\0';
    }
    // A parking door's pulse just ends; the contact reports the door.
    give();
}

void m2_channels_init(void)
{
    lock = xSemaphoreCreateMutex();
    for (int i = 0; i < m2_board.channel_count && i < MAX_CHANNELS; i++) {
        const m2_channel_t *ch = &m2_board.channels[i];
        if (ch->kind != M2_CH_INPUT && ch->kind != M2_CH_DIMMER) output(ch->relay_gpio);
        if (ch->kind == M2_CH_FAN || ch->kind == M2_CH_COOLER || ch->kind == M2_CH_CURTAIN) output(ch->relay2_gpio);
        if (ch->kind == M2_CH_COOLER) output(ch->relay3_gpio);
        uint8_t saved = m2_load_channel(i);
        switch (ch->kind) {
        case M2_CH_SWITCH:
            value[i] = saved & 1;
            if (ch->inhibit_gpio >= 0) {
                input(ch->inhibit_gpio, false);
                if (m2_channel_inhibited(i)) value[i] = 0;
            }
            relay(ch->relay_gpio, value[i]);
            break;
        case M2_CH_FAN:
        case M2_CH_COOLER: {
            int speed = (saved & 0x0f) <= 2 ? saved & 0x0f : 0;
            pump[i] = ch->kind == M2_CH_COOLER && (saved & 0x10);
            if (pump[i]) relay(ch->relay_gpio, true);
            drive_speed(i, speed);
            value[i] = speed;
            break;
        }
        case M2_CH_CURTAIN:
            // Never moves by itself after a power cut: where it was is kept.
            value[i] = saved & 1;
            break;
        case M2_CH_GARAGE:
            input(ch->sensor_gpio, false);
            value[i] = read_sensor(ch);
            break;
        case M2_CH_INPUT:
            input(ch->sensor_gpio, ch->sensor_driven);
            if (ch->relay_gpio >= 0) output(ch->relay_gpio);
            value[i] = read_sensor(ch);
            if (ch->relay_gpio >= 0) relay(ch->relay_gpio, value[i]);
            break;
        case M2_CH_MOMENTARY:
            // A strike never comes back on after a power cut.
            break;
        case M2_CH_DIMMER:
            value[i] = saved <= 100 ? saved : 0;
            last_on[i] = value[i] ? value[i] : 100;
            break;
        }
        if (ch->kind == M2_CH_MOMENTARY || ch->kind == M2_CH_CURTAIN || ch->kind == M2_CH_GARAGE) {
            esp_timer_create_args_t args = { .callback = timer_done, .arg = (void *)(intptr_t)i, .name = "channel" };
            esp_timer_create(&args, &timers[i]);
        }
    }
    // Dimmer boards have only dimmers, channels 0 … n-1, on one zero-cross detector.
    if (m2_board.channels[0].kind == M2_CH_DIMMER) {
        int gates[MAX_CHANNELS];
        for (int i = 0; i < m2_board.channel_count; i++) gates[i] = m2_board.channels[i].relay_gpio;
        m2_dimmer_start(m2_board.channels[0].sensor_gpio, gates, m2_board.channel_count);
        for (int i = 0; i < m2_board.channel_count; i++) m2_dimmer_set(i, value[i]);
    }
}

void m2_channels_listen(m2_channel_listener_t fn)
{
    listener = fn;
}

int m2_channel_value(int channel)
{
    return value[channel];
}

bool m2_channel_pump(int channel)
{
    return pump[channel];
}

bool m2_channel_inhibited(int channel)
{
    const m2_channel_t *ch = &m2_board.channels[channel];
    return ch->kind == M2_CH_SWITCH && ch->inhibit_gpio >= 0 && gpio_get_level(ch->inhibit_gpio) == (ch->inhibit_active_high ? 1 : 0);
}

/** Runs the curtain's motor towards `open` for the whole track; a move the other way reverses it. */
static void move_curtain(int channel, int open, const char *command_id)
{
    const m2_channel_t *ch = &m2_board.channels[channel];
    int on = open ? ch->relay_gpio : ch->relay2_gpio, off = open ? ch->relay2_gpio : ch->relay_gpio;
    bool reversing = moving[channel] && target[channel] != open;
    esp_timer_stop(timers[channel]);
    relay(off, false);
    // A command that is overtaken never completes; the server times it out.
    strlcpy(pending[channel], command_id ? command_id : "", sizeof(pending[channel]));
    if (reversing) vTaskDelay(pdMS_TO_TICKS(REVERSE_PAUSE_MS));
    // Always the whole track: after a power cut mid-way the board cannot know where it stopped.
    target[channel] = open;
    moving[channel] = true;
    relay(on, true);
    esp_timer_start_once(timers[channel], (uint64_t)ch->travel_ms * 1000);
}

static bool set(int channel, bool is_pump, int to, const char *command_id)
{
    const m2_channel_t *ch = &m2_board.channels[channel];
    switch (ch->kind) {
    case M2_CH_SWITCH:
        if (to && m2_channel_inhibited(channel)) return false;
        value[channel] = to ? 1 : 0;
        relay(ch->relay_gpio, value[channel]);
        save(channel);
        report(channel, command_id);
        break;
    case M2_CH_MOMENTARY:
        // On while asked: a key holds it; a command releases it for pulse_ms.
        esp_timer_stop(timers[channel]);
        value[channel] = to ? 1 : 0;
        relay(ch->relay_gpio, value[channel]);
        report(channel, command_id);
        if (to && command_id) esp_timer_start_once(timers[channel], (uint64_t)(ch->pulse_ms > 0 ? ch->pulse_ms : 5000) * 1000);
        break;
    case M2_CH_FAN:
    case M2_CH_COOLER:
        if (is_pump) {
            pump[channel] = to != 0;
            relay(ch->relay_gpio, pump[channel]);
        } else {
            drive_speed(channel, to);
            value[channel] = to;
        }
        save(channel);
        report(channel, command_id);
        break;
    case M2_CH_CURTAIN:
        move_curtain(channel, to, command_id);
        break;
    case M2_CH_GARAGE:
        if (read_sensor(ch) == to) {
            // Already there: nothing to move.
            report(channel, command_id);
            break;
        }
        // The door's controller takes a short pulse; the contact tells when it got there.
        target[channel] = to;
        strlcpy(pending[channel], command_id ? command_id : "", sizeof(pending[channel]));
        relay(ch->relay_gpio, true);
        esp_timer_stop(timers[channel]);
        esp_timer_start_once(timers[channel], (uint64_t)(ch->pulse_ms > 0 ? ch->pulse_ms : 1000) * 1000);
        break;
    case M2_CH_INPUT:
        // A sensor takes no commands.
        return false;
    case M2_CH_DIMMER:
        value[channel] = to;
        if (to) last_on[channel] = to;
        m2_dimmer_set(channel, to);
        save(channel);
        report(channel, command_id);
        break;
    }
    return true;
}

bool m2_channel_command(int channel, bool is_pump, int to, const char *command_id)
{
    if (channel < 0 || channel >= m2_board.channel_count) return false;
    take();
    bool done = set(channel, is_pump, to, command_id);
    give();
    return done;
}

void m2_channel_key(int channel, bool second, bool down)
{
    const m2_channel_t *ch = &m2_board.channels[channel];
    take();
    switch (ch->kind) {
    case M2_CH_SWITCH:
        if (down) set(channel, false, !value[channel], NULL);
        break;
    case M2_CH_MOMENTARY:
        // The strike is released while the key is held.
        set(channel, false, down, NULL);
        break;
    case M2_CH_FAN:
        if (down) set(channel, false, (value[channel] + 1) % 3, NULL);
        break;
    case M2_CH_DIMMER:
        if (down) set(channel, false, value[channel] ? 0 : last_on[channel], NULL);
        break;
    case M2_CH_CURTAIN:
        if (down) set(channel, false, second ? 0 : 1, NULL);
        break;
    default:
        break;
    }
    give();
}


void m2_channels_poll(void)
{
    take();
    for (int i = 0; i < m2_board.channel_count; i++) {
        const m2_channel_t *ch = &m2_board.channels[i];
        if (value[i] && m2_channel_inhibited(i)) set(i, false, 0, NULL);
        if (ch->kind != M2_CH_GARAGE && ch->kind != M2_CH_INPUT) continue;
        int now = read_sensor(ch);
        contact_count[i] = now != value[i] ? contact_count[i] + 1 : 0;
        if (contact_count[i] < CONTACT_SAMPLES) continue;
        contact_count[i] = 0;
        value[i] = now;
        // A leak sensor's buzzer sounds while it is wet, with or without internet.
        if (ch->kind == M2_CH_INPUT && ch->relay_gpio >= 0) relay(ch->relay_gpio, now);
        // The door got where the command asked: that completes it. Otherwise it is a report of its own.
        bool asked = pending[i][0] && now == target[i];
        report(i, asked ? pending[i] : NULL);
        if (asked) pending[i][0] = '\0';
    }
    give();
}

void m2_channel_blink(int channel, int times)
{
    if (channel < 0 || channel >= m2_board.channel_count || m2_board.channels[channel].kind != M2_CH_SWITCH) return;
    int gpio = m2_board.channels[channel].relay_gpio;
    for (int i = 0; i < times; i++) {
        relay(gpio, !value[channel]);
        vTaskDelay(pdMS_TO_TICKS(250));
        relay(gpio, value[channel]);
        vTaskDelay(pdMS_TO_TICKS(250));
    }
}
