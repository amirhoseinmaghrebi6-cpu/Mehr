#include <math.h>
#include <string.h>
#include "measure.h"
#include "board.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/uart.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define MAX_CHANNELS 20
#define PERIOD_MS 2000
/** Carbon monoxide: the buzzer sounds from 50 ppm and stops below 35. */
#define CO_ALARM_PPM 50
#define CO_QUIET_PPM 35

static const char *TAG = "measure";
static float values[MAX_CHANNELS][2];
static bool known[MAX_CHANNELS][2];
static float reported[MAX_CHANNELS][2];
static void (*listener)(int channel, const char *command_id);
static i2c_master_bus_handle_t bus;

/** How much a value must change before it is worth a report. */
static float step_of(const char *capability)
{
    if (strcmp(capability, "temperature") == 0) return 0.3f;
    if (strcmp(capability, "humidity") == 0) return 2.0f;
    if (strcmp(capability, "co2_ppm") == 0) return 50.0f;
    if (strcmp(capability, "co_ppm") == 0) return 5.0f;
    return 0;
}

static bool changed(const m2_channel_t *ch, int channel, int which, float now)
{
    if (!known[channel][which]) return true;
    float before = reported[channel][which];
    const char *capability = which ? ch->capability2 : ch->capability;
    // Light: 10 % of the reading, at least 5 lx.
    if (strcmp(capability, "illuminance_lux") == 0) return fabsf(now - before) >= fmaxf(5.0f, before * 0.1f);
    return fabsf(now - before) >= step_of(capability);
}

/** Sensirion's CRC-8 (poly 0x31, start 0xFF) over one 16-bit word. */
static bool crc_ok(const uint8_t *word)
{
    uint8_t crc = 0xFF;
    for (int i = 0; i < 2; i++) {
        crc ^= word[i];
        for (int bit = 0; bit < 8; bit++) crc = crc & 0x80 ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
    }
    return crc == word[2];
}

static i2c_master_dev_handle_t device(uint8_t address)
{
    i2c_device_config_t config = { .dev_addr_length = I2C_ADDR_BIT_LEN_7, .device_address = address, .scl_speed_hz = 100000 };
    i2c_master_dev_handle_t handle = NULL;
    i2c_master_bus_add_device(bus, &config, &handle);
    return handle;
}

/** SHT40 (0x44): temperature and humidity, high precision. */
static bool read_sht40(i2c_master_dev_handle_t dev, float *humidity, float *temperature)
{
    uint8_t command = 0xFD, data[6];
    if (i2c_master_transmit(dev, &command, 1, 100) != ESP_OK) return false;
    vTaskDelay(pdMS_TO_TICKS(10));
    if (i2c_master_receive(dev, data, 6, 100) != ESP_OK || !crc_ok(data) || !crc_ok(data + 3)) return false;
    *temperature = -45.0f + 175.0f * ((data[0] << 8) | data[1]) / 65535.0f;
    *humidity = fminf(100.0f, fmaxf(0.0f, -6.0f + 125.0f * ((data[3] << 8) | data[4]) / 65535.0f));
    return true;
}

/** BH1750 (0x23), in continuous high-resolution mode after start-up. */
static bool read_bh1750(i2c_master_dev_handle_t dev, float *lux)
{
    uint8_t data[2];
    if (i2c_master_receive(dev, data, 2, 100) != ESP_OK) return false;
    *lux = ((data[0] << 8) | data[1]) / 1.2f;
    return true;
}

static void send_command(i2c_master_dev_handle_t dev, uint16_t command)
{
    uint8_t bytes[2] = { command >> 8, command & 0xFF };
    i2c_master_transmit(dev, bytes, 2, 100);
}

/** SCD40 (0x62), measuring every 5 s on its own once started: CO₂ when a new reading is ready. */
static bool read_scd40(i2c_master_dev_handle_t dev, float *co2)
{
    uint8_t ready[3], data[9];
    send_command(dev, 0xE4B8);
    vTaskDelay(pdMS_TO_TICKS(2));
    if (i2c_master_receive(dev, ready, 3, 100) != ESP_OK || !crc_ok(ready) || !(((ready[0] << 8) | ready[1]) & 0x07FF)) return false;
    send_command(dev, 0xEC05);
    vTaskDelay(pdMS_TO_TICKS(2));
    if (i2c_master_receive(dev, data, 9, 100) != ESP_OK || !crc_ok(data)) return false;
    *co2 = (data[0] << 8) | data[1];
    return true;
}

/**
 * Winsen ZE07-CO on UART1 at 9600 baud, sending a frame every second on its own:
 * FF 17 04 00 HH LL FH FL CS, ppm = (HH·256 + LL) · 0.1, CS = two's complement of bytes 1–7.
 */
static bool read_ze07(float *ppm)
{
    uint8_t frame[9];
    bool found = false;
    // The newest whole frame in what has arrived.
    while (uart_read_bytes(UART_NUM_1, frame, 1, 0) == 1) {
        if (frame[0] != 0xFF || uart_read_bytes(UART_NUM_1, frame + 1, 8, pdMS_TO_TICKS(50)) != 8) continue;
        uint8_t sum = 0;
        for (int i = 1; i < 8; i++) sum += frame[i];
        if (frame[1] != 0x17 || (uint8_t)(~sum + 1) != frame[8]) continue;
        *ppm = ((frame[4] << 8) | frame[5]) * 0.1f;
        found = true;
    }
    return found;
}

static void run(void *arg)
{
    i2c_master_dev_handle_t devices[MAX_CHANNELS] = { 0 };
    for (int i = 0; i < m2_board.channel_count; i++) {
        const m2_channel_t *ch = &m2_board.channels[i];
        if (ch->kind != M2_CH_MEASURE) continue;
        if (ch->sensor == M2_SENSOR_SHT40) devices[i] = device(0x44);
        if (ch->sensor == M2_SENSOR_BH1750) {
            devices[i] = device(0x23);
            uint8_t on = 0x01, continuous = 0x10;
            i2c_master_transmit(devices[i], &on, 1, 100);
            i2c_master_transmit(devices[i], &continuous, 1, 100);
        }
        if (ch->sensor == M2_SENSOR_SCD40) {
            devices[i] = device(0x62);
            send_command(devices[i], 0x21B1);  // start periodic measurement
        }
    }
    for (;;) {
        for (int i = 0; i < m2_board.channel_count; i++) {
            const m2_channel_t *ch = &m2_board.channels[i];
            if (ch->kind != M2_CH_MEASURE) continue;
            float first = NAN, second = NAN;
            bool ok = false;
            switch (ch->sensor) {
            case M2_SENSOR_SHT40: ok = read_sht40(devices[i], &first, &second); break;
            case M2_SENSOR_BH1750: ok = read_bh1750(devices[i], &first); break;
            case M2_SENSOR_SCD40: ok = read_scd40(devices[i], &first); break;
            case M2_SENSOR_ZE07: ok = read_ze07(&first); break;
            }
            if (!ok) continue;
            // The CO buzzer sounds here, with or without internet.
            if (ch->sensor == M2_SENSOR_ZE07 && ch->relay_gpio >= 0) {
                if (first >= CO_ALARM_PPM) gpio_set_level(ch->relay_gpio, 1);
                else if (first < CO_QUIET_PPM) gpio_set_level(ch->relay_gpio, 0);
            }
            bool report = changed(ch, i, 0, first) || (!isnan(second) && changed(ch, i, 1, second));
            values[i][0] = first;
            known[i][0] = true;
            if (!isnan(second)) {
                values[i][1] = second;
                known[i][1] = true;
            }
            if (report && listener) {
                reported[i][0] = values[i][0];
                reported[i][1] = values[i][1];
                listener(i, NULL);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(PERIOD_MS));
    }
}

void m2_measure_start(void (*fn)(int channel, const char *command_id))
{
    listener = fn;
    bool i2c = false, uart = false;
    for (int i = 0; i < m2_board.channel_count; i++) {
        const m2_channel_t *ch = &m2_board.channels[i];
        if (ch->kind != M2_CH_MEASURE) continue;
        if (ch->sensor == M2_SENSOR_ZE07) uart = true;
        else i2c = true;
        if (ch->relay_gpio >= 0) {
            gpio_config_t out = { .pin_bit_mask = 1ULL << ch->relay_gpio, .mode = GPIO_MODE_OUTPUT };
            gpio_config(&out);
            gpio_set_level(ch->relay_gpio, 0);
        }
    }
    if (!i2c && !uart) return;
    if (i2c) {
        i2c_master_bus_config_t config = {
            .i2c_port = I2C_NUM_0, .sda_io_num = m2_board.i2c_sda_gpio, .scl_io_num = m2_board.i2c_scl_gpio,
            .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7, .flags.enable_internal_pullup = true,
        };
        if (i2c_new_master_bus(&config, &bus) != ESP_OK) ESP_LOGE(TAG, "No I2C bus");
    }
    if (uart) {
        uart_config_t config = { .baud_rate = 9600, .data_bits = UART_DATA_8_BITS, .parity = UART_PARITY_DISABLE, .stop_bits = UART_STOP_BITS_1, .source_clk = UART_SCLK_DEFAULT };
        uart_driver_install(UART_NUM_1, 256, 0, 0, NULL, 0);
        uart_param_config(UART_NUM_1, &config);
        uart_set_pin(UART_NUM_1, m2_board.uart_tx_gpio, m2_board.uart_rx_gpio, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    }
    xTaskCreate(run, "measure", 4096, NULL, 4, NULL);
}

bool m2_measure_value(int channel, bool second, float *value)
{
    if (channel < 0 || channel >= MAX_CHANNELS || !known[channel][second]) return false;
    *value = values[channel][second];
    return true;
}
