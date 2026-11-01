#include "dimmer.h"
#include "driver/gpio.h"
#include "driver/gptimer.h"
#include "esp_attr.h"

#define MAX_GATES 2
/* Iran's mains is 50 Hz: a half-wave lasts 10 ms, and the times below fit inside it. */
/** The gate pulse; the TRIAC latches long before it ends. */
#define GATE_US 100
/*
 * Calibration (hardware differs: the detector's pulse is wide and a little off the real zero, and
 * lamps differ): firing this soon after the pulse is full brightness, this late is 1 %. Fired too
 * close to the next zero, a TRIAC may not latch and the lamp flickers.
 */
#define EARLIEST_US 600
#define LATEST_US 9000
/** Pulses closer than this to the last one are noise on the detector, not a zero crossing. */
#define MIN_GAP_US 7000

static int gates[MAX_GATES];
static int gate_count;
/** Per gate: when to fire after the zero crossing, or 0 = off. */
static volatile uint32_t fire_at[MAX_GATES];
static gptimer_handle_t timer;
/** This half-wave's gate changes, in time order. */
static struct { uint32_t at; int gpio; int level; } events[2 * MAX_GATES];
static int event_count, next_event;
static bool counting;

static void IRAM_ATTR arm_next(void)
{
    if (next_event >= event_count) return;
    gptimer_alarm_config_t alarm = { .alarm_count = events[next_event].at };
    gptimer_set_alarm_action(timer, &alarm);
}

static bool IRAM_ATTR on_alarm(gptimer_handle_t t, const gptimer_alarm_event_data_t *event, void *arg)
{
    // Everything due now (two gates may fire at the same moment).
    while (next_event < event_count && events[next_event].at <= event->count_value + 10) {
        gpio_set_level(events[next_event].gpio, events[next_event].level);
        next_event++;
    }
    arm_next();
    return false;
}

static void IRAM_ATTR on_zero_cross(void *arg)
{
    uint64_t since = 0;
    gptimer_get_raw_count(timer, &since);
    if (counting && since < MIN_GAP_US) return;
    counting = true;
    gptimer_set_raw_count(timer, 0);
    // A new half-wave: every gate starts low, then fires at its time.
    event_count = 0;
    for (int i = 0; i < gate_count; i++) {
        gpio_set_level(gates[i], 0);
        uint32_t at = fire_at[i];
        if (!at) continue;
        events[event_count++] = (typeof(events[0])){ at, gates[i], 1 };
        events[event_count++] = (typeof(events[0])){ at + GATE_US, gates[i], 0 };
    }
    // At most four: an insertion sort.
    for (int i = 1; i < event_count; i++) {
        typeof(events[0]) e = events[i];
        int j = i - 1;
        for (; j >= 0 && events[j].at > e.at; j--) events[j + 1] = events[j];
        events[j + 1] = e;
    }
    next_event = 0;
    arm_next();
}

void m2_dimmer_start(int zero_cross_gpio, const int *gate_gpios, int count)
{
    gate_count = count < MAX_GATES ? count : MAX_GATES;
    for (int i = 0; i < gate_count; i++) {
        gates[i] = gate_gpios[i];
        gpio_config_t out = { .pin_bit_mask = 1ULL << gates[i], .mode = GPIO_MODE_OUTPUT };
        gpio_config(&out);
        gpio_set_level(gates[i], 0);
    }
    gptimer_config_t config = { .clk_src = GPTIMER_CLK_SRC_DEFAULT, .direction = GPTIMER_COUNT_UP, .resolution_hz = 1000000 };
    gptimer_new_timer(&config, &timer);
    gptimer_event_callbacks_t callbacks = { .on_alarm = on_alarm };
    gptimer_register_event_callbacks(timer, &callbacks, NULL);
    gptimer_enable(timer);
    gptimer_start(timer);

    gpio_config_t in = { .pin_bit_mask = 1ULL << zero_cross_gpio, .mode = GPIO_MODE_INPUT, .intr_type = GPIO_INTR_POSEDGE };
    gpio_config(&in);
    gpio_install_isr_service(0);
    gpio_isr_handler_add(zero_cross_gpio, on_zero_cross, NULL);
}

void m2_dimmer_set(int channel, int brightness)
{
    if (channel < 0 || channel >= gate_count) return;
    if (brightness <= 0) fire_at[channel] = 0;
    else if (brightness >= 100) fire_at[channel] = EARLIEST_US;
    else fire_at[channel] = LATEST_US - (uint32_t)(LATEST_US - EARLIEST_US) * (brightness - 1) / 99;
}
