/**
 * Sample scenes, routines and energy figures for the demo account. Real homes have no such data
 * yet (those sections show "coming soon"); homes, rooms and devices of the demo live in
 * services/demo-home.ts.
 */

export const scenes = [
  { id: "morning", name: "Good morning", detail: "Lights up · Curtains open", icon: "sunrise" },
  { id: "movie", name: "Movie night", detail: "Lights dim · Curtains close", icon: "film" },
  { id: "dinner", name: "Dinner", detail: "Warm light", icon: "utensils" },
  { id: "away", name: "Away", detail: "Lights and sockets off", icon: "door" },
];

export const automations = [
  { id: "sunset", name: "A softer sunset", detail: "Every day at sunset", destination: "Garden path lights", enabled: true, icon: "sunset" },
  { id: "arrive", name: "Welcome home", detail: "When Amir arrives", destination: "Entryway and climate", enabled: true, icon: "house" },
  { id: "sleep", name: "A quieter night", detail: "Every day at 10:30 pm", destination: "Whole home", enabled: true, icon: "moon" },
];

export type HomeSnapshot = {
  propertyId: string;
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
