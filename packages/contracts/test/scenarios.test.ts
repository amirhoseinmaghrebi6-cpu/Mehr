import { describe, expect, it } from "vitest";
import { scenarioRequest } from "../src/scenarios.js";

const action = { deviceId: "7e570003-0000-4000-8000-00000000000a", capability: "power", targetValue: true };

describe("scenario requests", () => {
  it("accepts the three kinds", () => {
    expect(scenarioRequest.safeParse({ kind: "periodic", name: "Evening", weekdays: [6, 2], time: "15:00", actions: [action] }).success).toBe(true);
    expect(scenarioRequest.safeParse({ kind: "one_time", name: "Trip", date: "2028-08-10", time: "08:00", actions: [action] }).success).toBe(true);
    expect(scenarioRequest.safeParse({ kind: "themed", name: "Morning", actions: [action] }).success).toBe(true);
  });

  it("defaults to enabled", () => {
    const parsed = scenarioRequest.parse({ kind: "themed", name: "Morning", actions: [action] });
    expect(parsed.enabled).toBe(true);
  });

  it("gives scheduled scenarios a 10-minute validity window unless another offered one is chosen", () => {
    const periodic = { kind: "periodic", name: "Evening", weekdays: [1], time: "15:00", actions: [action] };
    expect(scenarioRequest.parse(periodic)).toMatchObject({ lateWindowSeconds: 600 });
    expect(scenarioRequest.parse({ ...periodic, lateWindowSeconds: 0 })).toMatchObject({ lateWindowSeconds: 0 });
    expect(scenarioRequest.parse({ ...periodic, lateWindowSeconds: 10800 })).toMatchObject({ lateWindowSeconds: 10800 });
    expect(scenarioRequest.safeParse({ ...periodic, lateWindowSeconds: 7200 }).success).toBe(false);
    expect(scenarioRequest.safeParse({ kind: "themed", name: "Morning", actions: [action], lateWindowSeconds: 600 }).success).toBe(false);
  });

  it.each([
    ["no actions", { kind: "themed", name: "Empty", actions: [] }],
    ["no weekdays", { kind: "periodic", name: "x", weekdays: [], time: "15:00", actions: [action] }],
    ["a duplicate weekday", { kind: "periodic", name: "x", weekdays: [1, 1], time: "15:00", actions: [action] }],
    ["weekday 7", { kind: "periodic", name: "x", weekdays: [7], time: "15:00", actions: [action] }],
    ["24:00", { kind: "periodic", name: "x", weekdays: [1], time: "24:00", actions: [action] }],
    ["a 12-hour time", { kind: "periodic", name: "x", weekdays: [1], time: "3:00 PM", actions: [action] }],
    ["31 Shahrivar written as Gregorian 2028-09-31", { kind: "one_time", name: "x", date: "2028-09-31", time: "08:00", actions: [action] }],
    ["a one-time scenario without a date", { kind: "one_time", name: "x", time: "08:00", actions: [action] }],
    ["a time on a themed scenario", { kind: "themed", name: "x", time: "08:00", actions: [action] }],
    ["the same capability twice", { kind: "themed", name: "x", actions: [action, { ...action, targetValue: false }] }],
    ["an unknown capability", { kind: "themed", name: "x", actions: [{ ...action, capability: "pins" }] }],
    ["an empty name", { kind: "themed", name: "  ", actions: [action] }],
  ])("rejects %s", (_label, body) => {
    expect(scenarioRequest.safeParse(body).success).toBe(false);
  });
});
