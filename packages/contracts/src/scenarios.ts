/**
 * Scenarios of a home:
 * - periodic: on chosen weekdays at a local time ("Saturdays and Tuesdays at 15:00");
 * - one_time: once, on a local date at a local time ("20 Mordad 1407 at 08:00", stored Gregorian);
 * - themed: a named set of actions run by a tap ("Morning", "Party").
 *
 * Times and dates are in the home's time zone (Property.timeZone), never the phone's. Each action
 * becomes an ordinary command when the scenario runs. Scenarios run on the server. If the power or
 * internet was out at the scheduled time, a scenario still runs when it comes back within the
 * scenario's validity window (lateWindowSeconds); after the window it is recorded as missed. Only
 * the latest run is kept, and a one-time scenario is deleted once it is over.
 */
import { z } from "zod";
import { capabilities, type CapabilityName, type CapabilityValue } from "./catalog.js";

export const scenarioKinds = ["periodic", "one_time", "themed"] as const;
export type ScenarioKind = (typeof scenarioKinds)[number];

/** How late a scheduled scenario may still run: never, 10 minutes, 1 hour or 3 hours. */
export const scenarioLateWindows = [0, 600, 3600, 10800] as const;
export type ScenarioLateWindow = (typeof scenarioLateWindows)[number];
export const DEFAULT_SCENARIO_LATE_WINDOW: ScenarioLateWindow = 600;
/** The scheduler is always a few seconds behind, so even "never late" allows this much. */
export const SCENARIO_MIN_GRACE_SECONDS = 60;

/** Most actions one scenario may have. */
export const MAX_SCENARIO_ACTIONS = 50;

/** 0 = Sunday … 6 = Saturday (the same in every calendar). */
export const weekdays = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof weekdays)[number];

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24-hour");
/** A Gregorian date, YYYY-MM-DD. The app converts a Solar Hijri date with jalaliToGregorian. */
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return year >= 2000 && year <= 2200 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "not a date");

const lateWindow = z.union([z.literal(0), z.literal(600), z.literal(3600), z.literal(10800)]).default(DEFAULT_SCENARIO_LATE_WINDOW);

export const scenarioAction = z.strictObject({
  deviceId: z.uuid(),
  capability: z.enum(Object.keys(capabilities) as [CapabilityName, ...CapabilityName[]]),
  targetValue: z.union([z.boolean(), z.number().finite(), z.string().max(64)]),
});
export type ScenarioAction = z.infer<typeof scenarioAction>;

const scenarioBase = {
  name: z.string().trim().min(1).max(60),
  enabled: z.boolean().default(true),
  actions: z
    .array(scenarioAction)
    .min(1)
    .max(MAX_SCENARIO_ACTIONS)
    .refine((actions) => new Set(actions.map((action) => `${action.deviceId}:${action.capability}`)).size === actions.length, "one action per device capability"),
};

/** POST /v1/properties/:propertyId/scenarios and PUT …/scenarios/:scenarioId (the whole scenario). */
export const scenarioRequest = z.discriminatedUnion("kind", [
  z.strictObject({
    ...scenarioBase,
    kind: z.literal("periodic"),
    weekdays: z
      .array(z.int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, "duplicate weekday"),
    time: localTime,
    lateWindowSeconds: lateWindow,
  }),
  z.strictObject({ ...scenarioBase, kind: z.literal("one_time"), date: localDate, time: localTime, lateWindowSeconds: lateWindow }),
  z.strictObject({ ...scenarioBase, kind: z.literal("themed") }),
]);
export type ScenarioRequest = z.input<typeof scenarioRequest>;

/** PATCH /v1/properties/:propertyId/scenarios/:scenarioId: switch a scheduled scenario on or off. */
export const updateScenarioRequest = z.strictObject({ enabled: z.boolean() });
export type UpdateScenarioRequest = z.input<typeof updateScenarioRequest>;

export type ScenarioRunStatus = "started" | "missed";

export interface ScenarioRun {
  id: string;
  /** schedule: the server ran it at its time; manual: someone tapped it. */
  trigger: "schedule" | "manual";
  status: ScenarioRunStatus;
  /** The occurrence a scheduled run belongs to. */
  scheduledFor: string | null;
  createdAt: string;
}

export interface Scenario {
  id: string;
  name: string;
  kind: ScenarioKind;
  enabled: boolean;
  /** periodic only, sorted. */
  weekdays: Weekday[] | null;
  /** periodic and one_time: "HH:MM" in the home's time zone. */
  time: string | null;
  /** one_time only: Gregorian "YYYY-MM-DD" in the home's time zone. */
  date: string | null;
  /** periodic and one_time: how late it may still run, in seconds (0 = never late). */
  lateWindowSeconds: ScenarioLateWindow | null;
  actions: Array<{ deviceId: string; capability: CapabilityName; targetValue: CapabilityValue }>;
  /** The next time it runs, or null (themed, switched off, or a one-time scenario that is over). */
  nextRunAt: string | null;
  lastRun: ScenarioRun | null;
}

/** GET /v1/properties/:propertyId/scenarios */
export interface ScenarioListResponse {
  scenarios: Scenario[];
}

/** POST /v1/properties/:propertyId/scenarios/:scenarioId/run (themed scenarios). */
export interface ScenarioRunResponse {
  run: ScenarioRun;
  /** The commands the run created, one per action, in order. */
  commandIds: string[];
}
