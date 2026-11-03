#include <string.h>
#include "meter.h"
#include "meter_calc.h"
#include "board.h"
#include "storage.h"
#include "driver/uart.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

#define PERIOD_MS 1000
/** Power and voltage changes go out at most this often, so a busy home does not flood the server. */
#define MIN_REPORT_US (30LL * 1000 * 1000)
/** The total is saved to flash every 0.1 kWh. */
#define SAVE_STEP_MWH 100000.0
#define ENERGY_EVERY_US (9LL * 60 * 1000 * 1000)

static const char *TAG = "meter";
static void (*listener)(int channel, const char *command_id);
static int channel = -1;
static m2_meter_reading_t now, reported;
static bool known, ever_reported;
static double total_mwh, saved_mwh;
static int64_t reported_at, energy_at = -ENERGY_EVERY_US;

/** Asks the BL0942 for its full packet; true with a good one. */
static bool read_meter(m2_meter_reading_t *reading)
{
    static const uint8_t ask[] = { 0x58, 0xAA };
    uint8_t frame[23];
    uart_flush_input(UART_NUM_1);
    uart_write_bytes(UART_NUM_1, ask, sizeof(ask));
    if (uart_read_bytes(UART_NUM_1, frame, sizeof(frame), pdMS_TO_TICKS(100)) != sizeof(frame)) return false;
    return m2_bl0942_parse(frame, CONFIG_M2_METER_COUNTS_PER_VOLT / 1000.0f, CONFIG_M2_METER_COUNTS_PER_AMP / 1000.0f, CONFIG_M2_METER_COUNTS_PER_WATT / 1000.0f, reading);
}

static void run(void *arg)
{
    int64_t last = esp_timer_get_time();
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(PERIOD_MS));
        m2_meter_reading_t reading;
        int64_t at = esp_timer_get_time();
        if (!read_meter(&reading)) continue;
        // After missed readings, at most a few seconds count: better a little low than made up.
        double seconds = (at - last) / 1e6;
        last = at;
        total_mwh += m2_meter_mwh(reading.watts, seconds > 5 ? 5 : seconds);
        if (total_mwh - saved_mwh >= SAVE_STEP_MWH) {
            m2_save_energy_mwh((uint64_t)total_mwh);
            saved_mwh = total_mwh;
        }
        now = reading;
        known = true;
        bool worth = !ever_reported || m2_meter_worth_report(reported.watts, now.watts, reported.volts, now.volts);
        if (worth && at - reported_at >= MIN_REPORT_US && listener) {
            reported = now;
            reported_at = at;
            ever_reported = true;
            listener(channel, NULL);
        }
    }
}

void m2_meter_start(void (*fn)(int channel, const char *command_id))
{
    for (int i = 0; i < m2_board.channel_count; i++) {
        if (m2_board.channels[i].kind == M2_CH_METER) channel = i;
    }
    if (channel < 0) return;
    listener = fn;
    total_mwh = saved_mwh = m2_load_energy_mwh();
    uart_config_t config = { .baud_rate = 4800, .data_bits = UART_DATA_8_BITS, .parity = UART_PARITY_DISABLE, .stop_bits = UART_STOP_BITS_1, .source_clk = UART_SCLK_DEFAULT };
    uart_driver_install(UART_NUM_1, 256, 0, 0, NULL, 0);
    uart_param_config(UART_NUM_1, &config);
    uart_set_pin(UART_NUM_1, m2_board.uart_tx_gpio, m2_board.uart_rx_gpio, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    ESP_LOGI(TAG, "Meter total %.3f kWh", total_mwh / 1e6);
    xTaskCreate(run, "meter", 3072, NULL, 4, NULL);
}

bool m2_meter_values(float *watts, float *volts, double *kwh)
{
    if (!known) return false;
    *watts = now.watts;
    *volts = now.volts;
    *kwh = total_mwh / 1e6;
    return true;
}

bool m2_meter_energy_due(void)
{
    int64_t at = esp_timer_get_time();
    if (at - energy_at < ENERGY_EVERY_US) return false;
    energy_at = at;
    return true;
}
