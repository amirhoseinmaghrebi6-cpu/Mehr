/* Just enough of ESP-IDF for channels.c and board.c to run on a PC (firmware/test/run.sh). */
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

typedef int esp_err_t;

typedef enum { GPIO_MODE_INPUT, GPIO_MODE_OUTPUT } gpio_mode_t;
enum { GPIO_PULLUP_ENABLE = 1, GPIO_PULLDOWN_ENABLE = 1 };
typedef struct { uint64_t pin_bit_mask; gpio_mode_t mode; int pull_up_en; int pull_down_en; } gpio_config_t;
int gpio_config(const gpio_config_t *config);
int gpio_set_level(int gpio, uint32_t level);
int gpio_get_level(int gpio);

typedef void (*esp_timer_cb_t)(void *arg);
typedef struct { esp_timer_cb_t callback; void *arg; const char *name; } esp_timer_create_args_t;
typedef struct stub_timer *esp_timer_handle_t;
int esp_timer_create(const esp_timer_create_args_t *args, esp_timer_handle_t *out);
int esp_timer_start_once(esp_timer_handle_t timer, uint64_t us);
int esp_timer_stop(esp_timer_handle_t timer);
int64_t esp_timer_get_time(void);
#define GPIO_IS_VALID_OUTPUT_GPIO(gpio) ((gpio) < 34)

typedef void *SemaphoreHandle_t;
#define portMAX_DELAY 0
#define pdMS_TO_TICKS(ms) (ms)
static inline SemaphoreHandle_t xSemaphoreCreateMutex(void) { return (void *)1; }
static inline int xSemaphoreTake(SemaphoreHandle_t s, int t) { (void)s; (void)t; return 1; }
static inline int xSemaphoreGive(SemaphoreHandle_t s) { (void)s; return 1; }
static inline void vTaskDelay(int ticks) { (void)ticks; }

/* Older glibc has no strlcpy. */
#include <string.h>
static inline size_t stub_strlcpy(char *out, const char *in, size_t size)
{
    size_t length = strlen(in);
    if (size) {
        size_t n = length < size - 1 ? length : size - 1;
        memcpy(out, in, n);
        out[n] = '\0';
    }
    return length;
}
#define strlcpy stub_strlcpy
