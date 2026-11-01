#include "sdkconfig.h"
#if CONFIG_M2_BOARD_CAM
#include <stdio.h>
#include <sys/stat.h>
#include "camera.h"
#include "storage.h"
#include "driver/sdmmc_host.h"
#include "esp_camera.h"
#include "esp_log.h"
#include "esp_vfs_fat.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#define FRAME_MS 500
#define MOUNT "/sdcard"

static const char *TAG = "camera";
static int channel;
static void (*listener)(int channel, const char *command_id);
static bool power, recording;
static bool mounted;
static int folder, frame;
static SemaphoreHandle_t lock;

/** AI-Thinker ESP32-CAM: the OV2640's pins are fixed by the module. */
static const camera_config_t config = {
    .pin_pwdn = 32, .pin_reset = -1, .pin_xclk = 0, .pin_sccb_sda = 26, .pin_sccb_scl = 27,
    .pin_d7 = 35, .pin_d6 = 34, .pin_d5 = 39, .pin_d4 = 36, .pin_d3 = 21, .pin_d2 = 19, .pin_d1 = 18, .pin_d0 = 5,
    .pin_vsync = 25, .pin_href = 23, .pin_pclk = 22,
    .xclk_freq_hz = 20000000, .ledc_timer = LEDC_TIMER_0, .ledc_channel = LEDC_CHANNEL_0,
    .pixel_format = PIXFORMAT_JPEG, .frame_size = FRAMESIZE_VGA, .jpeg_quality = 12, .fb_count = 2,
    .fb_location = CAMERA_FB_IN_PSRAM, .grab_mode = CAMERA_GRAB_LATEST,
};

static void save(void)
{
    m2_save_channel(channel, (uint8_t)(power | (recording << 1)));
}

/** The card in 1-bit mode (GPIO 2, 14, 15), so the flash LED on GPIO 4 stays dark. */
static bool mount(void)
{
    if (mounted) return true;
    sdmmc_host_t host = SDMMC_HOST_DEFAULT();
    sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
    slot.width = 1;
    esp_vfs_fat_sdmmc_mount_config_t options = { .format_if_mount_failed = false, .max_files = 2, .allocation_unit_size = 16 * 1024 };
    sdmmc_card_t *card;
    mounted = esp_vfs_fat_sdmmc_mount(MOUNT, &host, &slot, &options, &card) == ESP_OK;
    if (!mounted) ESP_LOGW(TAG, "No usable microSD card");
    return mounted;
}

/** A new folder R0001, R0002 … after the highest one on the card. */
static bool new_folder(void)
{
    char path[32];
    struct stat info;
    for (folder = 1; folder < 10000; folder++) {
        snprintf(path, sizeof(path), MOUNT "/R%04d", folder);
        if (stat(path, &info) != 0) break;
    }
    frame = 0;
    return folder < 10000 && mkdir(path, 0775) == 0;
}

static bool set_power(bool on)
{
    if (on == power) return true;
    if (on && esp_camera_init(&config) != ESP_OK) {
        ESP_LOGE(TAG, "The camera does not answer");
        return false;
    }
    if (!on) esp_camera_deinit();
    power = on;
    return true;
}

static bool set_recording(bool on)
{
    if (on && (!power || !mount() || !new_folder())) return false;
    recording = on;
    return true;
}

static void tell(const char *command_id)
{
    if (listener) listener(channel, command_id);
}

static void record(void *arg)
{
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(FRAME_MS));
        xSemaphoreTake(lock, portMAX_DELAY);
        bool stopped = false;
        if (recording) {
            camera_fb_t *fb = esp_camera_fb_get();
            char path[40];
            snprintf(path, sizeof(path), MOUNT "/R%04d/F%05d.JPG", folder, frame++);
            FILE *file = fb ? fopen(path, "wb") : NULL;
            bool written = file && fwrite(fb->buf, 1, fb->len, file) == fb->len;
            if (file) fclose(file);
            if (fb) esp_camera_fb_return(fb);
            // A full or missing card ends the recording, and the app is told.
            if (!written || frame >= 100000) {
                ESP_LOGW(TAG, "Recording stopped: the card is full or gone");
                recording = false;
                save();
                stopped = true;
            }
        }
        xSemaphoreGive(lock);
        if (stopped) tell(NULL);
    }
}

void m2_camera_start(int camera_channel, void (*fn)(int channel, const char *command_id))
{
    channel = camera_channel;
    listener = fn;
    lock = xSemaphoreCreateMutex();
    uint8_t saved = m2_load_channel(channel);
    if (saved & 1) set_power(true);
    if (saved & 2) set_recording(true);
    xTaskCreate(record, "record", 4096, NULL, 3, NULL);
}

bool m2_camera_power(void)
{
    return power;
}

bool m2_camera_recording(void)
{
    return recording;
}

const char *m2_camera_refuse(bool is_recording, bool on)
{
    return is_recording && on && !power ? "camera_off" : NULL;
}

void m2_camera_command(bool is_recording, bool on, const char *command_id)
{
    xSemaphoreTake(lock, portMAX_DELAY);
    if (is_recording) {
        set_recording(on);
    } else {
        // Off also ends a recording.
        if (!on) recording = false;
        set_power(on);
    }
    save();
    xSemaphoreGive(lock);
    // The real state, whatever was asked: a missing card or camera shows as off.
    tell(command_id);
}
#else
/* Every other board has no camera: nothing to start, and nothing is ever on. */
#include "camera.h"
void m2_camera_start(int camera_channel, void (*fn)(int channel, const char *command_id)) {}
bool m2_camera_power(void) { return false; }
bool m2_camera_recording(void) { return false; }
const char *m2_camera_refuse(bool is_recording, bool on) { return "unknown_target"; }
void m2_camera_command(bool is_recording, bool on, const char *command_id) {}
#endif
