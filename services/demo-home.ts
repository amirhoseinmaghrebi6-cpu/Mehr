/**
 * Sample homes for the demo account, in the same shape the API returns. The demo never touches
 * the database: this data lives in the demo visitor's browser (services/demo-gateway.ts).
 */
import { capabilities, deviceTypes, type CapabilityName, type CapabilityValue, type Device, type DeviceType, type Property, type Room, type Scenario } from "@m2smart/contracts";
import { messages, type Locale } from "@/lib/i18n";

export type DemoData = {
  properties: Property[];
  rooms: Record<string, Room[]>;
  devices: Record<string, Device[]>;
  /** Missing in demo data saved before scenarios existed: then the samples are added. */
  scenarios?: Record<string, Scenario[]>;
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
    boardId: null,
    boardName: null,
    hidden: false,
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
      { id: "tehran", name: "Tehran Villa", type: "villa", address: "Niavaran, Tehran", coverPhoto: "living", timeZone: "Asia/Tehran", role: "owner" },
      { id: "caspian", name: "Caspian House", type: "house", address: "Ramsar, Mazandaran", coverPhoto: "exterior", timeZone: "Asia/Tehran", role: "owner" },
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
        demoDevice("coffee", "socket", "Coffee machine", "kitchen", { power: false }),
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
      ],
    },
  };
}

/**
 * Sample boards for presenting pairing in the demo. Their pairing QR codes are images served by
 * the app (public/images/demo); uploading one adds the board's channels, like a real board would.
 * In the demo a sample code can be used again and again.
 */
export const demoBoards: Record<string, { name: string; image: string; channels: Array<[type: DeviceType, name: string, values?: Partial<Record<CapabilityName, CapabilityValue>>]> }> = {
  "DEMO-SWITCH-2CH": { name: "2-switch board", image: "/images/demo/pairing-switch-2ch.png", channels: [["switch", "Switch 1"], ["switch", "Switch 2"]] },
  "DEMO-COOLER": { name: "Cooler board", image: "/images/demo/pairing-cooler.png", channels: [["cooler", "Cooler"]] },
  "DEMO-MULTI-6CH": {
    name: "6-channel board",
    image: "/images/demo/pairing-multi-6ch.png",
    channels: [["switch", "Switch 1"], ["switch", "Switch 2"], ["dimmer", "Dimmer", { brightness: 0 }], ["socket", "Socket"], ["curtain", "Curtain"], ["contact_sensor", "Window sensor"]],
  },
};

/** Sample scenarios of the demo homes (their device ids are those above). */
export function createDemoScenarios(): Record<string, Scenario[]> {
  const scenario = (id: string, name: string, actions: Array<[string, CapabilityName, CapabilityValue]>, schedule: Partial<Scenario> = {}): Scenario => ({
    id,
    name,
    kind: "themed",
    enabled: true,
    weekdays: null,
    time: null,
    date: null,
    lateWindowSeconds: null,
    actions: actions.map(([deviceId, capability, targetValue]) => ({ deviceId, capability, targetValue })),
    nextRunAt: null,
    lastRun: null,
    ...schedule,
  });
  return {
    tehran: [
      scenario("scenario-morning", "Good morning", [["pendant", "brightness", 80], ["curtains", "curtain", "open"]]),
      scenario("scenario-movie", "Movie night", [["pendant", "brightness", 15], ["curtains", "curtain", "closed"]]),
      scenario("scenario-away", "Away", [["pendant", "brightness", 0], ["kitchen-lights", "power", false], ["coffee", "power", false], ["path-lights", "power", false]]),
      scenario("scenario-evening", "Evening path lights", [["path-lights", "power", true]], { kind: "periodic", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "19:00", lateWindowSeconds: 3600 }),
      scenario("scenario-garden", "Water the garden", [["garden-pump", "power", true]], { kind: "periodic", weekdays: [2, 6], time: "06:30", lateWindowSeconds: 0 }),
    ],
    caspian: [scenario("scenario-night", "Good night", [["c-lamp", "brightness", 0], ["c-fan", "speed", "off"]])],
  };
}

/** The demo's sample homes, rooms and devices in the visitor's language; other names are shown as typed. */
export function demoName(name: string, locale: Locale): string {
  return messages[locale].demo.names[name] ?? name;
}
