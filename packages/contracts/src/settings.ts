/**
 * The user's display preferences (GET/PATCH /v1/me/settings), stored on the account. Values are
 * always stored in one unit (°C, Gregorian dates); the settings only change how they are shown.
 */
import { z } from "zod";

export const languages = ["fa", "en", "ar"] as const;
export type Language = (typeof languages)[number];

/** Solar Hijri (the Iranian calendar) or Gregorian. */
export const calendars = ["solar_hijri", "gregorian"] as const;
export type Calendar = (typeof calendars)[number];

export const temperatureUnits = ["celsius", "fahrenheit"] as const;
export type TemperatureUnit = (typeof temperatureUnits)[number];

export interface UserSettings {
  language: Language;
  calendar: Calendar;
  temperatureUnit: TemperatureUnit;
}

export const defaultSettings: UserSettings = { language: "en", calendar: "solar_hijri", temperatureUnit: "celsius" };

export const updateSettingsRequest = z
  .strictObject({
    language: z.enum(languages),
    calendar: z.enum(calendars),
    temperatureUnit: z.enum(temperatureUnits),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "nothing to update");
export type UpdateSettingsRequest = z.input<typeof updateSettingsRequest>;

/** °C (as stored) → the unit the user reads. */
export function displayTemperature(celsius: number, unit: TemperatureUnit): number {
  return unit === "fahrenheit" ? (celsius * 9) / 5 + 32 : celsius;
}
