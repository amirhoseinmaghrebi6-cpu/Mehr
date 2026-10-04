/**
 * How each device type of the catalog (packages/contracts/src/catalog.ts) looks and behaves in the
 * app: icon, the one-tap action on its card, and a short status line. Names and wording come from
 * the message files (messages/*.ts). Values here are what the ESP32 reported, or the target of a
 * command still on its way.
 */
import {
  AlarmSmoke,
  Blinds,
  Cctv,
  CloudFog,
  DoorOpen,
  Droplet,
  Droplets,
  Fan,
  Footprints,
  Gauge,
  Lightbulb,
  PersonStanding,
  PlugZap,
  Siren,
  Sun,
  ToggleRight,
  Warehouse,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { displayTemperature, type CapabilityName, type CapabilityState, type CapabilityValue, type Device, type DeviceType, type PhotoPreset, type TemperatureUnit } from "@m2smart/contracts";
import { EvaporativeCooler, WaterPump } from "@/components/icons";
import { formatNumber, messages, type Locale } from "@/lib/i18n";

export { formatNumber } from "@/lib/i18n";

/** Each icon shows what the device does (product owner's rule): reviewed together, keep it that way. */
export const deviceTypeInfo: Record<DeviceType, { icon: LucideIcon; tone: string }> = {
  switch: { icon: ToggleRight, tone: "plug" },
  dimmer: { icon: Lightbulb, tone: "light" },
  socket: { icon: PlugZap, tone: "plug" },
  cooler: { icon: EvaporativeCooler, tone: "climate" },
  fan: { icon: Fan, tone: "climate" },
  pump: { icon: WaterPump, tone: "climate" },
  curtain: { icon: Blinds, tone: "curtain" },
  garage_door: { icon: Warehouse, tone: "lock" },
  alarm: { icon: Siren, tone: "lock" },
  camera: { icon: Cctv, tone: "lock" },
  motion_sensor: { icon: Footprints, tone: "air" },
  presence_sensor: { icon: PersonStanding, tone: "air" },
  contact_sensor: { icon: DoorOpen, tone: "air" },
  leak_sensor: { icon: Droplets, tone: "air" },
  smoke_sensor: { icon: AlarmSmoke, tone: "air" },
  co_sensor: { icon: CloudFog, tone: "air" },
  air_quality_sensor: { icon: Wind, tone: "air" },
  humidity_sensor: { icon: Droplet, tone: "climate" },
  light_sensor: { icon: Sun, tone: "light" },
  energy_meter: { icon: Gauge, tone: "plug" },
};

export const typeLabel = (type: DeviceType, locale: Locale) => messages[locale].devices.types[type];
export const capabilityLabel = (capability: CapabilityName, locale: Locale) => messages[locale].devices.capabilities[capability];

/**
 * A capability value as people read it, e.g. "Open", "68%", "On", "620 ppm". Temperatures are
 * stored in °C and shown in the user's unit.
 */
export function valueLabel(capability: CapabilityName, value: CapabilityValue | null, locale: Locale, temperatureUnit: TemperatureUnit = "celsius"): string {
  const m = messages[locale].devices;
  if (value === null) return m.waitingForReport;
  if (typeof value === "string") return m.enumValues[value] ?? value;
  if (typeof value === "boolean") {
    const pair = m.booleanValues[capability];
    if (pair) return value ? pair[0] : pair[1];
    return value ? m.on : m.off;
  }
  const units: Partial<Record<CapabilityName, string>> = {
    brightness: m.units.percent,
    humidity: m.units.percent,
    temperature: temperatureUnit === "fahrenheit" ? m.units.fahrenheit : m.units.celsius,
    co_ppm: m.units.ppm,
    co2_ppm: m.units.ppm,
    illuminance_lux: m.units.lux,
    power_w: m.units.watt,
    energy_kwh: m.units.kwh,
  };
  const digits = capability === "energy_kwh" || capability === "temperature" ? 1 : 0;
  const shown = capability === "temperature" ? displayTemperature(value, temperatureUnit) : value;
  return `${formatNumber(shown, locale, digits)}${units[capability] ?? ""}`;
}

export function stateOf(device: Device, capability: CapabilityName): CapabilityState | undefined {
  return device.capabilities.find((entry) => entry.capability === capability);
}

/** The capability the card's one-tap button changes, if the device has one. */
export function primaryCapability(device: Device): CapabilityName | null {
  const order: Partial<Record<DeviceType, CapabilityName>> = {
    switch: "power",
    socket: "power",
    pump: "power",
    camera: "power",
    dimmer: "brightness",
    cooler: "speed",
    fan: "speed",
    curtain: "curtain",
    garage_door: "door",
    alarm: "alarm_mode",
  };
  const capability = order[device.type];
  return capability && stateOf(device, capability)?.writable ? capability : null;
}

/** Device types whose one-tap action is asked for again before it is sent. */
export const confirmBeforeCommand: ReadonlySet<DeviceType> = new Set(["garage_door", "alarm"]);

/** Whether the device is "on" (or open, running, armed) for the card's highlight. */
export function isActive(type: DeviceType, value: CapabilityValue | null): boolean {
  if (value === null) return false;
  switch (type) {
    case "dimmer":
      return typeof value === "number" && value > 0;
    case "cooler":
    case "fan":
      return value !== "off";
    case "curtain":
    case "garage_door":
      return value === "open";
    case "alarm":
      return value !== "disarmed";
    default:
      return value === true;
  }
}

/**
 * The value the card's button sends: the opposite of `current`. A dimmer goes back to its last
 * brightness (or full); a cooler or fan starts on low.
 */
export function toggledValue(type: DeviceType, current: CapabilityValue | null, lastBrightness = 100): CapabilityValue {
  const active = isActive(type, current);
  switch (type) {
    case "dimmer":
      return active ? 0 : Math.max(1, lastBrightness);
    case "cooler":
    case "fan":
      return active ? "off" : "low";
    case "curtain":
    case "garage_door":
      return active ? "closed" : "open";
    case "alarm":
      return active ? "disarmed" : "armed_away";
    default:
      return !active;
  }
}

/** Sensor states that need attention. */
export function isAlert(device: Device): boolean {
  return device.capabilities.some(
    (entry) =>
      (["leak", "smoke", "triggered"].includes(entry.capability) && entry.value === true) ||
      (entry.capability === "co_ppm" && typeof entry.value === "number" && entry.value >= 50),
  );
}

/** One line under the device name: its most telling values. */
export function deviceSummary(device: Device, valueOf: (capability: CapabilityName) => CapabilityValue | null, locale: Locale, temperatureUnit: TemperatureUnit = "celsius"): string {
  if (!device.online) return messages[locale].devices.offline;
  // With several values, plain "On"/"Off" would be ambiguous ("Off · Off"), so those get their name.
  const several = device.capabilities.length > 1;
  const plain = (capability: CapabilityName) => capability === "power" || capability === "pump" || capability === "speed";
  const shown = device.capabilities.slice(0, 2).map((entry) => {
    const value = valueLabel(entry.capability, valueOf(entry.capability), locale, temperatureUnit);
    return several && plain(entry.capability) ? `${capabilityLabel(entry.capability, locale)}: ${value}` : value;
  });
  return shown.join(" · ") || typeLabel(device.type, locale);
}

/** Built-in photos (public/images) for homes and rooms. */
export const photoPresetList: PhotoPreset[] = ["living", "exterior", "kitchen", "bedroom"];

export function photoUrl(preset: PhotoPreset, size: "large" | "small" = "small"): string {
  if (size === "large" && (preset === "living" || preset === "exterior")) return `/images/${preset}-1920.webp`;
  return `/images/${preset}-960.webp`;
}
