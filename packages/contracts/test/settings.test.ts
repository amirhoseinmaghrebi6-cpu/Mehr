import { describe, expect, it } from "vitest";
import { defaultSettings, displayTemperature, updateSettingsRequest } from "../src/settings.js";

describe("user settings", () => {
  it("defaults to English, Solar Hijri and Celsius", () => {
    expect(defaultSettings).toEqual({ language: "en", calendar: "solar_hijri", temperatureUnit: "celsius", palette: "sage" });
  });

  it("accepts partial updates of known values only", () => {
    expect(updateSettingsRequest.safeParse({ language: "ar" }).success).toBe(true);
    expect(updateSettingsRequest.safeParse({ calendar: "gregorian", temperatureUnit: "fahrenheit" }).success).toBe(true);
    expect(updateSettingsRequest.safeParse({ palette: "ocean" }).success).toBe(true);
    for (const body of [{}, { language: "de" }, { calendar: "lunar_hijri" }, { temperatureUnit: "kelvin" }, { palette: "neon" }, { theme: "dark" }]) {
      expect(updateSettingsRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("converts stored Celsius for display", () => {
    expect(displayTemperature(0, "fahrenheit")).toBe(32);
    expect(displayTemperature(100, "fahrenheit")).toBe(212);
    expect(displayTemperature(22.5, "celsius")).toBe(22.5);
  });
});
