export type DeviceKind = "light" | "climate" | "curtain" | "lock" | "air" | "plug";

export type Device = {
  id: string;
  name: string;
  kind: DeviceKind;
  roomId: string;
  room: string;
  detail: string;
  value?: number;
  online: boolean;
  initialState: boolean;
};

export type Room = {
  id: string;
  name: string;
  temperature: number;
  humidity: number;
  activeDevices: number;
  image: string;
  imagePosition?: string;
};

export type PropertyType = "house" | "villa" | "apartment" | "office" | "commercial" | "custom";

export type Property = {
  id: string;
  name: string;
  address: string;
  type: PropertyType;
  coverImage: string;
  online: boolean;
};

export const properties: Property[] = [
  { id: "tehran", name: "Tehran Villa", address: "Niavaran, Tehran", type: "villa", coverImage: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1800&q=84", online: true },
  { id: "caspian", name: "Caspian House", address: "Ramsar, Mazandaran", type: "house", coverImage: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1800&q=84", online: true },
];

export const rooms: Room[] = [
  {
    id: "living",
    name: "Living room",
    temperature: 22,
    humidity: 41,
    activeDevices: 5,
    image:
      "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=82",
    imagePosition: "center 54%",
  },
  {
    id: "kitchen",
    name: "Kitchen",
    temperature: 21,
    humidity: 46,
    activeDevices: 4,
    image:
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=82",
    imagePosition: "center 58%",
  },
  {
    id: "bedroom",
    name: "Primary suite",
    temperature: 20,
    humidity: 43,
    activeDevices: 6,
    image:
      "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=900&q=82",
    imagePosition: "center 53%",
  },
  {
    id: "terrace",
    name: "Garden terrace",
    temperature: 19,
    humidity: 52,
    activeDevices: 3,
    image:
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=82",
    imagePosition: "center 60%",
  },
];

export const devices: Device[] = [
  { id: "climate", name: "Climate", kind: "climate", roomId: "bedroom", room: "Primary suite", detail: "22°C · Auto", value: 22, online: true, initialState: true },
  { id: "lights", name: "Pendant lights", kind: "light", roomId: "living", room: "Living room", detail: "Warm white · 68%", value: 68, online: true, initialState: true },
  { id: "curtains", name: "Sheer curtains", kind: "curtain", roomId: "living", room: "Living room", detail: "Open · 75%", value: 75, online: true, initialState: true },
  { id: "entry-lock", name: "Front door", kind: "lock", roomId: "living", room: "Entryway", detail: "Deadbolt secured", online: true, initialState: true },
  { id: "air-quality", name: "Air quality", kind: "air", roomId: "living", room: "Living room", detail: "Excellent · 18 μg/m³", value: 18, online: true, initialState: true },
  { id: "coffee", name: "Coffee machine", kind: "plug", roomId: "kitchen", room: "Kitchen", detail: "Ready when you are", online: true, initialState: false },
  { id: "garden-lights", name: "Path lighting", kind: "light", roomId: "terrace", room: "Garden terrace", detail: "Soft white · 40%", value: 40, online: true, initialState: false },
  { id: "window", name: "Bedroom window", kind: "plug", roomId: "bedroom", room: "Primary suite", detail: "Sensor · Closed", online: true, initialState: false },
];

export const scenes = [
  { id: "morning", name: "Good morning", detail: "Lights up · Curtains open", icon: "sunrise" },
  { id: "movie", name: "Movie night", detail: "Lights dim · Curtains close", icon: "film" },
  { id: "dinner", name: "Dinner", detail: "Warm light · Music on", icon: "utensils" },
  { id: "away", name: "Away", detail: "Secure · Energy saved", icon: "door" },
];

export const automations = [
  { id: "sunset", name: "A softer sunset", detail: "Every day at sunset", destination: "Garden path lights", enabled: true, icon: "sunset" },
  { id: "arrive", name: "Welcome home", detail: "When Amir arrives", destination: "Entryway and climate", enabled: true, icon: "house" },
  { id: "sleep", name: "A quieter night", detail: "Every day at 10:30 pm", destination: "Whole home", enabled: true, icon: "moon" },
];

export type HomeSnapshot = {
  propertyId: string;
  rooms: Room[];
  devices: Device[];
  scenes: typeof scenes;
  automations: typeof automations;
  energy: {
    currentWatts: number;
    todayKwh: number;
    yesterdayKwh: number;
    points: number[];
  };
};

export function getMockHomeSnapshot(propertyId = "tehran"): HomeSnapshot {
  const multiplier = propertyId === "caspian" ? 0.72 : 1;

  return {
    propertyId,
    rooms,
    devices,
    scenes,
    automations,
    energy: {
      currentWatts: Math.round(642 * multiplier),
      todayKwh: Number((8.4 * multiplier).toFixed(1)),
      yesterdayKwh: Number((9.6 * multiplier).toFixed(1)),
      points: [24, 19, 23, 16, 28, 31, 24, 19, 36, 29, 42, 31, 35, 25, 39, 32, 48, 37, 30, 44, 34, 46, 38, 29],
    },
  };
}

export async function getHomeSnapshot(propertyId = "tehran"): Promise<HomeSnapshot> {
  return getMockHomeSnapshot(propertyId);
}