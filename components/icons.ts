/**
 * Device icons that lucide does not have, drawn on lucide's 24×24 grid with the same stroke style,
 * so they sit next to lucide icons without looking different.
 */
import { createLucideIcon } from "lucide-react";

/** A water pump: motor block, pump housing, outlet pipe and base. */
export const WaterPump = createLucideIcon("WaterPump", [
  ["rect", { x: "2", y: "9", width: "8", height: "8", rx: "1", key: "motor" }],
  ["path", { d: "M10 13h1", key: "shaft" }],
  ["circle", { cx: "15", cy: "13", r: "4", key: "housing" }],
  ["path", { d: "M15 9V5h5", key: "outlet" }],
  ["path", { d: "M19 13h3", key: "inlet" }],
  ["path", { d: "M2 21h20", key: "base" }],
  ["path", { d: "M6 17v4M15 17v4", key: "feet" }],
]);

/** An evaporative cooler (کولر آبی): a box with pad louvers and water below. */
export const EvaporativeCooler = createLucideIcon("EvaporativeCooler", [
  ["rect", { x: "3", y: "3", width: "18", height: "15", rx: "2", key: "body" }],
  ["path", { d: "M7 7h10M7 10.5h10M7 14h10", key: "louvers" }],
  ["path", { d: "M5 21.5c1.4-.8 2.6-.8 4 0s2.6.8 4 0 2.6-.8 4 0 2.6.8 3 0", key: "water" }],
]);
