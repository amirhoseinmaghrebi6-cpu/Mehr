import { describe, expect, it } from "vitest";
import { allowsCapability, capabilities, capabilityValueError, deviceTypes, isCapabilityName, isDeviceType } from "../src/catalog.js";
import { createCommandRequest, createPropertyRequest, createRoomRequest, updateDeviceRequest, updatePropertyRequest } from "../src/homes.js";

describe("device catalog", () => {
  it("only refers to defined capabilities, which match the database name pattern", () => {
    for (const name of Object.keys(capabilities)) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    for (const { required, optional } of Object.values(deviceTypes)) {
      for (const capability of [...required, ...optional]) expect(isCapabilityName(capability)).toBe(true);
    }
  });

  it("models the agreed hardware", () => {
    expect(deviceTypes.switch.required).toEqual(["power"]);
    expect(capabilities.power.valueType).toBe("boolean");
    expect(capabilities.brightness).toMatchObject({ valueType: "integer", min: 0, max: 100 });
    expect(deviceTypes.cooler.required).toEqual(["pump", "speed"]);
    expect(capabilities.speed.values).toEqual(["off", "low", "high"]);
    expect(capabilities.curtain.values).toEqual(["open", "closed"]);
    expect(capabilities.door.values).toEqual(["open", "closed"]);
  });

  it("keeps sensor values read-only", () => {
    for (const name of ["motion", "presence", "contact", "leak", "smoke", "co_ppm", "humidity", "power_w", "energy_kwh", "triggered"] as const) {
      expect(capabilities[name].writable).toBe(false);
    }
  });

  it("knows which capabilities a type may have", () => {
    expect(allowsCapability("socket", "power_w")).toBe(true);
    expect(allowsCapability("switch", "brightness")).toBe(false);
    expect(isDeviceType("dimmer")).toBe(true);
    expect(isDeviceType("toaster")).toBe(false);
    expect(isCapabilityName("constructor")).toBe(false);
  });

  it("validates values against a capability", () => {
    expect(capabilityValueError(capabilities.power, true)).toBeNull();
    expect(capabilityValueError(capabilities.power, "on")).not.toBeNull();
    expect(capabilityValueError(capabilities.brightness, 0)).toBeNull();
    expect(capabilityValueError(capabilities.brightness, 100)).toBeNull();
    expect(capabilityValueError(capabilities.brightness, 101)).not.toBeNull();
    expect(capabilityValueError(capabilities.brightness, -1)).not.toBeNull();
    expect(capabilityValueError(capabilities.brightness, 40.5)).not.toBeNull();
    expect(capabilityValueError(capabilities.brightness, Number.NaN)).not.toBeNull();
    expect(capabilityValueError(capabilities.speed, "low")).toBeNull();
    expect(capabilityValueError(capabilities.speed, "turbo")).not.toBeNull();
    expect(capabilityValueError(capabilities.curtain, "stop")).not.toBeNull();
  });
});

describe("request schemas", () => {
  it("fills defaults and trims names when creating a home", () => {
    expect(createPropertyRequest.parse({ name: "  Tehran  " })).toEqual({ name: "Tehran", type: "house", address: "", coverPhoto: "living" });
  });

  it("rejects empty, oversized and unknown fields", () => {
    expect(createPropertyRequest.safeParse({ name: "   " }).success).toBe(false);
    expect(createPropertyRequest.safeParse({ name: "x".repeat(81) }).success).toBe(false);
    expect(createPropertyRequest.safeParse({ name: "A", organizationId: "x" }).success).toBe(false);
    expect(createRoomRequest.safeParse({ name: "Kitchen", photo: "https://example.com/a.jpg" }).success).toBe(false);
    expect(updatePropertyRequest.safeParse({}).success).toBe(false);
  });

  it("never lets a device update touch its hardware", () => {
    expect(updateDeviceRequest.safeParse({ name: "Lamp" }).success).toBe(true);
    expect(updateDeviceRequest.safeParse({ roomId: null }).success).toBe(true);
    expect(updateDeviceRequest.safeParse({ controllerId: "00000000-0000-4000-8000-000000000000" }).success).toBe(false);
    expect(updateDeviceRequest.safeParse({ gpio: 16 }).success).toBe(false);
  });

  it("validates commands", () => {
    const ok = { deviceId: "7e5a0000-0000-4000-8000-000000000001", capability: "brightness", targetValue: 40, idempotencyKey: "abc12345" };
    expect(createCommandRequest.safeParse(ok).success).toBe(true);
    expect(createCommandRequest.safeParse({ ...ok, capability: "self_destruct" }).success).toBe(false);
    expect(createCommandRequest.safeParse({ ...ok, idempotencyKey: "short" }).success).toBe(false);
    expect(createCommandRequest.safeParse({ ...ok, idempotencyKey: "has spaces!!" }).success).toBe(false);
    expect(createCommandRequest.safeParse({ ...ok, deviceId: "not-a-uuid" }).success).toBe(false);
    expect(createCommandRequest.safeParse({ ...ok, targetValue: { nested: true } }).success).toBe(false);
  });
});
