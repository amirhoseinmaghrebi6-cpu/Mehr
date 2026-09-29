/**
 * How each device type of the catalog (packages/contracts/src/catalog.ts) looks and behaves in the
 * app: icon, names in English and Persian, the one-tap action on its card, and a short status line.
 * Values here are what the ESP32 reported, or the target of a command still on its way.
 */
import {
  AirVent,
  AlarmSmoke,
  Blinds,
  CloudFog,
  Droplets,
  Fan,
  Gauge,
  Lamp,
  PlugZap,
  Power,
  ScanEye,
  ShieldAlert,
  Snowflake,
  Sun,
  Warehouse,
  Waves,
  PersonStanding,
  DoorOpen,
  type LucideIcon,
} from "lucide-react";
import type { CapabilityName, CapabilityState, CapabilityValue, Device, DeviceType, PhotoPreset } from "@m2smart/contracts";
import type { Locale } from "@/lib/i18n";

type Text = { en: string; fa: string };

export const deviceTypeInfo: Record<DeviceType, Text & { icon: LucideIcon; tone: string }> = {
  switch: { en: "Switch", fa: "کلید", icon: Power, tone: "plug" },
  dimmer: { en: "Dimmer", fa: "دیمر", icon: Lamp, tone: "light" },
  socket: { en: "Smart socket", fa: "پریز هوشمند", icon: PlugZap, tone: "plug" },
  cooler: { en: "Evaporative cooler", fa: "کولر آبی", icon: Snowflake, tone: "climate" },
  fan: { en: "Fan", fa: "فن", icon: Fan, tone: "climate" },
  curtain: { en: "Curtain / shutter", fa: "پرده / کرکره", icon: Blinds, tone: "curtain" },
  garage_door: { en: "Parking door", fa: "درب پارکینگ", icon: Warehouse, tone: "lock" },
  alarm: { en: "Alarm", fa: "دزدگیر", icon: ShieldAlert, tone: "lock" },
  motion_sensor: { en: "Motion sensor", fa: "سنسور حرکت", icon: ScanEye, tone: "air" },
  presence_sensor: { en: "Presence sensor", fa: "سنسور حضور", icon: PersonStanding, tone: "air" },
  contact_sensor: { en: "Door / window sensor", fa: "سنسور در / پنجره", icon: DoorOpen, tone: "air" },
  leak_sensor: { en: "Water leak sensor", fa: "سنسور نشت آب", icon: Droplets, tone: "air" },
  smoke_sensor: { en: "Smoke sensor", fa: "سنسور دود", icon: AlarmSmoke, tone: "air" },
  co_sensor: { en: "CO sensor", fa: "سنسور CO", icon: CloudFog, tone: "air" },
  air_quality_sensor: { en: "Air quality sensor", fa: "سنسور کیفیت هوا", icon: AirVent, tone: "air" },
  humidity_sensor: { en: "Humidity sensor", fa: "سنسور رطوبت", icon: Waves, tone: "climate" },
  light_sensor: { en: "Light sensor", fa: "سنسور نور", icon: Sun, tone: "light" },
  energy_meter: { en: "Energy meter", fa: "کنتور انرژی", icon: Gauge, tone: "plug" },
};

export const capabilityLabels: Record<CapabilityName, Text> = {
  power: { en: "Power", fa: "روشن / خاموش" },
  brightness: { en: "Brightness", fa: "شدت نور" },
  pump: { en: "Water pump", fa: "پمپ آب" },
  speed: { en: "Speed", fa: "دور موتور" },
  curtain: { en: "Curtain", fa: "پرده" },
  door: { en: "Door", fa: "درب" },
  alarm_mode: { en: "Alarm mode", fa: "حالت دزدگیر" },
  triggered: { en: "Alarm triggered", fa: "آژیر فعال" },
  motion: { en: "Motion", fa: "حرکت" },
  presence: { en: "Presence", fa: "حضور" },
  contact: { en: "Door / window", fa: "در / پنجره" },
  leak: { en: "Water leak", fa: "نشت آب" },
  smoke: { en: "Smoke", fa: "دود" },
  co_ppm: { en: "Carbon monoxide", fa: "مونوکسید کربن" },
  co2_ppm: { en: "CO₂", fa: "دی‌اکسید کربن" },
  voc_index: { en: "VOC index", fa: "شاخص VOC" },
  humidity: { en: "Humidity", fa: "رطوبت" },
  temperature: { en: "Temperature", fa: "دما" },
  illuminance_lux: { en: "Light level", fa: "شدت روشنایی محیط" },
  power_w: { en: "Power now", fa: "توان لحظه‌ای" },
  energy_kwh: { en: "Energy used", fa: "انرژی مصرفی" },
};

const enumLabels: Record<string, Text> = {
  off: { en: "Off", fa: "خاموش" },
  low: { en: "Low", fa: "کند" },
  high: { en: "High", fa: "تند" },
  open: { en: "Open", fa: "باز" },
  closed: { en: "Closed", fa: "بسته" },
  disarmed: { en: "Disarmed", fa: "غیرفعال" },
  armed_home: { en: "Armed (home)", fa: "فعال (در خانه)" },
  armed_away: { en: "Armed (away)", fa: "فعال (بیرون)" },
};

const units: Partial<Record<CapabilityName, Text>> = {
  brightness: { en: "%", fa: "٪" },
  humidity: { en: "%", fa: "٪" },
  temperature: { en: "°C", fa: "°" },
  co_ppm: { en: " ppm", fa: " ppm" },
  co2_ppm: { en: " ppm", fa: " ppm" },
  illuminance_lux: { en: " lx", fa: " لوکس" },
  power_w: { en: " W", fa: " وات" },
  energy_kwh: { en: " kWh", fa: " کیلووات‌ساعت" },
};

export const text = (value: Text, locale: Locale) => value[locale];

export function formatNumber(value: number, locale: Locale, fractionDigits = 0): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: fractionDigits }).format(value);
}

/** A capability value as people read it, e.g. "Open", "68%", "On", "620 ppm". */
export function valueLabel(capability: CapabilityName, value: CapabilityValue | null, locale: Locale): string {
  if (value === null) return locale === "fa" ? "در انتظار گزارش" : "Waiting for report";
  if (typeof value === "string") return enumLabels[value] ? text(enumLabels[value], locale) : value;
  if (typeof value === "boolean") {
    const alert: Partial<Record<CapabilityName, [Text, Text]>> = {
      motion: [{ en: "Motion", fa: "حرکت دیده شد" }, { en: "Clear", fa: "بدون حرکت" }],
      presence: [{ en: "Someone is here", fa: "حضور دارد" }, { en: "Nobody", fa: "کسی نیست" }],
      leak: [{ en: "Leak!", fa: "نشت آب!" }, { en: "Dry", fa: "خشک" }],
      smoke: [{ en: "Smoke!", fa: "دود!" }, { en: "Clear", fa: "عادی" }],
      triggered: [{ en: "Triggered!", fa: "آژیر فعال!" }, { en: "Quiet", fa: "آرام" }],
    };
    const pair = alert[capability];
    if (pair) return text(value ? pair[0] : pair[1], locale);
    return value ? (locale === "fa" ? "روشن" : "On") : (locale === "fa" ? "خاموش" : "Off");
  }
  const digits = capability === "energy_kwh" || capability === "temperature" ? 1 : 0;
  return `${formatNumber(value, locale, digits)}${units[capability] ? text(units[capability]!, locale) : ""}`;
}

export function stateOf(device: Device, capability: CapabilityName): CapabilityState | undefined {
  return device.capabilities.find((entry) => entry.capability === capability);
}

/** The capability the card's one-tap button changes, if the device has one. */
export function primaryCapability(device: Device): CapabilityName | null {
  const order: Partial<Record<DeviceType, CapabilityName>> = {
    switch: "power",
    socket: "power",
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
export function deviceSummary(device: Device, valueOf: (capability: CapabilityName) => CapabilityValue | null, locale: Locale): string {
  if (!device.online) return locale === "fa" ? "آفلاین" : "Offline";
  const shown = device.capabilities.slice(0, 2).map((entry) => valueLabel(entry.capability, valueOf(entry.capability), locale));
  return shown.join(" · ") || text(deviceTypeInfo[device.type], locale);
}

/** Built-in photos (public/images) for homes and rooms. */
export const photoOptions: Array<{ preset: PhotoPreset } & Text> = [
  { preset: "living", en: "Living room", fa: "پذیرایی" },
  { preset: "exterior", en: "Exterior", fa: "نمای بیرون" },
  { preset: "kitchen", en: "Kitchen", fa: "آشپزخانه" },
  { preset: "bedroom", en: "Bedroom", fa: "اتاق خواب" },
];

export function photoUrl(preset: PhotoPreset, size: "large" | "small" = "small"): string {
  if (size === "large" && (preset === "living" || preset === "exterior")) return `/images/${preset}-1920.webp`;
  return `/images/${preset}-960.webp`;
}
