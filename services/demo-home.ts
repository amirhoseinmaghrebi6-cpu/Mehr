/**
 * Sample homes for the demo account, in the same shape the API returns. The demo never touches
 * the database: this data lives in the demo visitor's browser (services/demo-gateway.ts).
 */
import { capabilities, deviceTypes, type CapabilityName, type CapabilityValue, type Device, type DeviceType, type Property, type Room } from "@m2smart/contracts";
import type { Locale } from "@/lib/i18n";

export type DemoData = {
  properties: Property[];
  rooms: Record<string, Room[]>;
  devices: Record<string, Device[]>;
};

/** A device of `type` with every capability of the type and the given reported values. */
export function demoDevice(id: string, type: DeviceType, name: string, roomId: string | null, values: Partial<Record<CapabilityName, CapabilityValue>> = {}): Device {
  const { required, optional } = deviceTypes[type];
  const names = [...required, ...optional.filter((capability) => capability in values)] as CapabilityName[];
  const now = new Date().toISOString();
  return {
    id,
    name,
    type,
    roomId,
    online: true,
    lastSeenAt: now,
    capabilities: names.map((capability) => ({
      capability,
      writable: capabilities[capability].writable,
      value: values[capability] ?? neutralValue(capability),
      reportedAt: now,
    })),
  };
}

function neutralValue(capability: CapabilityName): CapabilityValue {
  const definition = capabilities[capability];
  if (definition.valueType === "boolean") return false;
  if (definition.valueType === "enum") return definition.values.find((value) => value === "off" || value === "closed" || value === "disarmed") ?? definition.values[0];
  return "min" in definition && definition.min !== undefined ? definition.min : 0;
}

export function createDemoData(): DemoData {
  const room = (id: string, name: string, photo: Room["photo"], sortOrder: number): Room => ({ id, name, photo, sortOrder });
  return {
    properties: [
      { id: "tehran", name: "Tehran Villa", type: "villa", address: "Niavaran, Tehran", coverPhoto: "living", role: "owner" },
      { id: "caspian", name: "Caspian House", type: "house", address: "Ramsar, Mazandaran", coverPhoto: "exterior", role: "owner" },
    ],
    rooms: {
      tehran: [room("living", "Living room", "living", 0), room("kitchen", "Kitchen", "kitchen", 1), room("bedroom", "Primary suite", "bedroom", 2), room("terrace", "Garden terrace", "exterior", 3)],
      caspian: [room("c-living", "Living room", "living", 0), room("c-bedroom", "Bedroom", "bedroom", 1)],
    },
    devices: {
      tehran: [
        demoDevice("pendant", "dimmer", "Pendant lights", "living", { brightness: 68 }),
        demoDevice("curtains", "curtain", "Sheer curtains", "living", { curtain: "open" }),
        demoDevice("alarm", "alarm", "Home alarm", "living", { alarm_mode: "disarmed", triggered: false }),
        demoDevice("air", "air_quality_sensor", "Air quality", "living", { co2_ppm: 620, voc_index: 90 }),
        demoDevice("climate", "humidity_sensor", "Humidity & temperature", "living", { humidity: 41, temperature: 22.5 }),
        demoDevice("kitchen-lights", "switch", "Kitchen lights", "kitchen", { power: true }),
        demoDevice("coffee", "socket", "Coffee machine", "kitchen", { power: false, power_w: 0, energy_kwh: 3.2 }),
        demoDevice("leak", "leak_sensor", "Under-sink leak sensor", "kitchen", { leak: false }),
        demoDevice("smoke", "smoke_sensor", "Kitchen smoke sensor", "kitchen", { smoke: false }),
        demoDevice("cooler", "cooler", "Evaporative cooler", "bedroom", { pump: false, speed: "off" }),
        demoDevice("window", "contact_sensor", "Bedroom window", "bedroom", { contact: "closed" }),
        demoDevice("path-lights", "switch", "Path lighting", "terrace", { power: false }),
        demoDevice("garage", "garage_door", "Parking door", "terrace", { door: "closed" }),
        demoDevice("garden-pump", "pump", "Garden pump", "terrace", { power: false }),
        demoDevice("entrance-camera", "camera", "Entrance camera", "terrace", { power: true, recording: false }),
      ],
      caspian: [
        demoDevice("c-lamp", "dimmer", "Reading lamp", "c-living", { brightness: 40 }),
        demoDevice("c-fan", "fan", "Ceiling fan", "c-bedroom", { speed: "off" }),
        demoDevice("c-window", "contact_sensor", "Balcony door", "c-living", { contact: "closed" }),
        demoDevice("c-motion", "motion_sensor", "Hallway motion", "c-living", { motion: false }),
        demoDevice("c-presence", "presence_sensor", "Bedroom presence", "c-bedroom", { presence: true }),
        demoDevice("c-co", "co_sensor", "Heater CO sensor", "c-living", { co_ppm: 3 }),
        demoDevice("c-light", "light_sensor", "Daylight sensor", "c-living", { illuminance_lux: 320 }),
        demoDevice("c-meter", "energy_meter", "Main energy meter", null, { power_w: 1240, energy_kwh: 512.4 }),
      ],
    },
  };
}

const persianNames: Record<string, string> = {
  "Tehran Villa": "ویلای تهران",
  "Caspian House": "خانه‌ی کاسپین",
  "Niavaran, Tehran": "نیاوران، تهران",
  "Ramsar, Mazandaran": "رامسر، مازندران",
  "Living room": "پذیرایی",
  Kitchen: "آشپزخانه",
  "Primary suite": "اتاق خواب اصلی",
  "Garden terrace": "تراس باغ",
  Bedroom: "اتاق خواب",
  "Pendant lights": "چراغ‌های آویز",
  "Sheer curtains": "پرده‌های حریر",
  "Home alarm": "دزدگیر خانه",
  "Air quality": "کیفیت هوا",
  "Humidity & temperature": "رطوبت و دما",
  "Kitchen lights": "چراغ‌های آشپزخانه",
  "Coffee machine": "قهوه‌ساز",
  "Under-sink leak sensor": "سنسور نشت زیر سینک",
  "Kitchen smoke sensor": "سنسور دود آشپزخانه",
  "Evaporative cooler": "کولر آبی",
  "Bedroom window": "پنجره‌ی اتاق خواب",
  "Path lighting": "چراغ‌های مسیر",
  "Parking door": "درب پارکینگ",
  "Reading lamp": "چراغ مطالعه",
  "Ceiling fan": "پنکه‌ی سقفی",
  "Balcony door": "درب بالکن",
  "Garden pump": "پمپ باغ",
  "Entrance camera": "دوربین ورودی",
  "Hallway motion": "سنسور حرکت راهرو",
  "Bedroom presence": "سنسور حضور اتاق خواب",
  "Heater CO sensor": "سنسور CO بخاری",
  "Daylight sensor": "سنسور نور روز",
  "Main energy meter": "کنتور اصلی",
};

/** Persian names of the demo's sample homes, rooms and devices; other names are shown as typed. */
export function demoName(name: string, locale: Locale): string {
  return locale === "fa" ? (persianNames[name] ?? name) : name;
}
