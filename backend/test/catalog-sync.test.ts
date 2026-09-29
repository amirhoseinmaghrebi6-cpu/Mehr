/**
 * The database and packages/contracts describe the same catalog; this keeps them in sync.
 * Requires the dev stack and a migrated database.
 */
import { capabilities, deviceTypeNames, isCapabilityName, photoPresets, pinFunctions } from "@m2smart/contracts";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadBackendEnv } from "../src/env";

let admin: Client;

beforeAll(async () => {
  loadBackendEnv();
  admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL, application_name: "m2smart-catalog-sync-test" });
  await admin.connect();
});
afterAll(() => admin.end());

describe("catalog sync between database and contracts", () => {
  it("has the same device types", async () => {
    const { rows } = await admin.query<{ type: string }>("select type from public.device_types order by type");
    expect(rows.map((row) => row.type)).toEqual([...deviceTypeNames].sort());
  });

  it("accepts exactly the built-in photos", async () => {
    for (const preset of photoPresets) {
      const { rows } = await admin.query<{ ok: boolean }>("select public.is_photo_preset($1) as ok", [preset]);
      expect(rows[0].ok, preset).toBe(true);
    }
    const { rows } = await admin.query<{ ok: boolean }>("select public.is_photo_preset('https://example.com/a.jpg') as ok");
    expect(rows[0].ok).toBe(false);
  });

  it("allows every pin function the contracts know", async () => {
    const { rows } = await admin.query<{ definition: string }>(
      "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.hardware_model_pins'::regclass and pg_get_constraintdef(oid) like '%relay%triac_gate%'",
    );
    for (const fn of pinFunctions) expect(rows[0]?.definition).toContain(`'${fn}'`);
  });

  it("stores catalog capability templates that match the contracts' definitions", async () => {
    const { rows } = await admin.query<{ capability: string; value_type: string; min_value: string | null; max_value: string | null; enum_values: string[] | null; writable: boolean }>(
      "select capability, value_type, min_value, max_value, enum_values, writable from public.hardware_model_capabilities",
    );
    for (const row of rows) {
      expect(isCapabilityName(row.capability), row.capability).toBe(true);
      if (!isCapabilityName(row.capability)) continue;
      const definition = capabilities[row.capability];
      expect(row.value_type, row.capability).toBe(definition.valueType);
      expect(row.writable, row.capability).toBe(definition.writable);
      if ("values" in definition) expect(row.enum_values, row.capability).toEqual([...definition.values]);
      if ("min" in definition && definition.min !== undefined) expect(Number(row.min_value), row.capability).toBe(definition.min);
      if ("max" in definition && definition.max !== undefined) expect(Number(row.max_value), row.capability).toBe(definition.max);
    }
  });
});
