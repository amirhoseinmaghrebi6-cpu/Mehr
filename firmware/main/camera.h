/*
 * The ESP32-CAM board (docs/board-lineup.md, "M2-CAM"): "power" switches the OV2640 on or off;
 * "recording" saves a JPEG frame every half second to the microSD card, one folder per recording.
 * Recording needs the camera on, and switching it off also stops recording. Both come back after a
 * power cut. Live video comes in a later version.
 */
#pragma once

#include <stdbool.h>

/** Brings back the saved state; `listener` is told when the channel changes (as for channels.h). */
void m2_camera_start(int channel, void (*listener)(int channel, const char *command_id));
bool m2_camera_power(void);
bool m2_camera_recording(void);
/** Why a command cannot be done now ("camera_off": recording asked while off), or NULL. */
const char *m2_camera_refuse(bool recording, bool on);
void m2_camera_command(bool recording, bool on, const char *command_id);
