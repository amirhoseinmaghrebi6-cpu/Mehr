/**
 * Phase 1 seed: attaches the "tehran" property, one hub, and the prototype devices to an
 * existing Supabase user. Idempotent — every row uses a fixed id or natural key and is upserted.
 *
 * Usage: pnpm seed:phase1
 *
 * Reads backend/.env.local (gitignored). Required:
 *   SUPABASE_URL                (falls back to NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY   (server-only; never expose to the Next.js app)
 *   PHASE1_TEST_USER_EMAIL      (must already exist in Supabase Auth; never created here)
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Fixed, non-secret identifiers so reruns converge on the same rows.
const PROPERTY_ID = "5eed0001-0000-4000-8000-000000000001";
const PROPERTY_SLUG = "tehran";
const HUB_ID = "5eed0002-0000-4000-8000-000000000001";
const HUB_HARDWARE_ID = "phase1-sim-hub-tehran-01";

type ValueType = "boolean" | "integer" | "number" | "enum";
type Capability = {
  capability: string;
  value_type: ValueType;
  min_value?: number;
  max_value?: number;
  step?: number;
  enum_values?: string[];
  unit?: string;
  writable?: boolean;
  initial: boolean | number | string;
};
type SeedDevice = { id: string; external_id: string; name: string; kind: string; room_name: string; capabilities: Capability[] };

const power = (initial: boolean): Capability => ({ capability: "power", value_type: "boolean", initial });

// Mirrors services/mock-home-service.ts so later phases can swap the mock for real rows.
const DEVICES: SeedDevice[] = [
  {
    id: "5eed0003-0000-4000-8000-000000000001", external_id: "climate", name: "Climate", kind: "climate", room_name: "Primary suite",
    capabilities: [
      power(true),
      { capability: "target_temperature", value_type: "number", min_value: 16, max_value: 30, step: 0.5, unit: "°C", initial: 22 },
      { capability: "mode", value_type: "enum", enum_values: ["auto", "cool", "heat", "fan"], initial: "auto" },
    ],
  },
  {
    id: "5eed0003-0000-4000-8000-000000000002", external_id: "lights", name: "Pendant lights", kind: "light", room_name: "Living room",
    capabilities: [power(true), { capability: "brightness", value_type: "integer", min_value: 0, max_value: 100, step: 1, unit: "%", initial: 68 }],
  },
  {
    id: "5eed0003-0000-4000-8000-000000000003", external_id: "curtains", name: "Sheer curtains", kind: "curtain", room_name: "Living room",
    capabilities: [{ capability: "position", value_type: "integer", min_value: 0, max_value: 100, step: 1, unit: "%", initial: 75 }],
  },
  {
    id: "5eed0003-0000-4000-8000-000000000004", external_id: "entry-lock", name: "Front door", kind: "lock", room_name: "Entryway",
    capabilities: [{ capability: "locked", value_type: "boolean", initial: true }],
  },
  {
    id: "5eed0003-0000-4000-8000-000000000005", external_id: "air-quality", name: "Air quality", kind: "air", room_name: "Living room",
    capabilities: [{ capability: "pm25", value_type: "number", min_value: 0, unit: "μg/m³", writable: false, initial: 18 }],
  },
  {
    id: "5eed0003-0000-4000-8000-000000000006", external_id: "coffee", name: "Coffee machine", kind: "plug", room_name: "Kitchen",
    capabilities: [power(false)],
  },
  {
    id: "5eed0003-0000-4000-8000-000000000007", external_id: "garden-lights", name: "Path lighting", kind: "light", room_name: "Garden terrace",
    capabilities: [power(false), { capability: "brightness", value_type: "integer", min_value: 0, max_value: 100, step: 1, unit: "%", initial: 40 }],
  },
  {
    id: "5eed0003-0000-4000-8000-000000000008", external_id: "window", name: "Bedroom window", kind: "sensor", room_name: "Primary suite",
    capabilities: [{ capability: "open", value_type: "boolean", writable: false, initial: false }],
  },
];

class SeedError extends Error {}

function loadEnv() {
  const envFile = resolve(__dirname, "../.env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.PHASE1_TEST_USER_EMAIL?.trim().toLowerCase();
  const missing = [!url && "SUPABASE_URL", !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY", !email && "PHASE1_TEST_USER_EMAIL"].filter(Boolean);
  if (missing.length) throw new SeedError(`Missing ${missing.join(", ")}. Set them in backend/.env.local (see backend/.env.example).`);
  return { url: url!, serviceRoleKey: serviceRoleKey!, email: email! };
}

function check<T>(result: { data: T; error: null } | { data: unknown; error: { message: string } }, action: string): T {
  if (result.error) throw new SeedError(`${action} failed: ${result.error.message}`);
  return result.data;
}

async function findUserId(supabase: SupabaseClient, email: string): Promise<string> {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { users } = check(await supabase.auth.admin.listUsers({ page, perPage }), "Listing auth users");
    const user = users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user.id;
    if (users.length < perPage) break;
  }
  throw new SeedError(
    `Test user ${email} does not exist in Supabase Auth. Register and confirm it through the app's /register flow, then rerun. ` +
      "The seed intentionally never creates users or passwords.",
  );
}

async function resolveOrganizationId(supabase: SupabaseClient, userId: string): Promise<string> {
  const existing = check(await supabase.from("properties").select("organization_id").eq("id", PROPERTY_ID).maybeSingle<{ organization_id: string }>(), "Reading seeded property");
  const memberships = check(
    await supabase.from("organization_members").select("organization_id").eq("user_id", userId).eq("role", "owner").order("created_at"),
    "Reading organization memberships",
  );

  if (existing) {
    if (!memberships.some((row) => row.organization_id === existing.organization_id)) {
      throw new SeedError(`Property ${PROPERTY_ID} already belongs to an organization this user does not own. Refusing to move it.`);
    }
    return existing.organization_id;
  }
  if (!memberships.length) {
    throw new SeedError("Test user owns no organization. The on_auth_user_created trigger should have created one; check the auth migration.");
  }
  return memberships[0].organization_id;
}

async function seed() {
  const { url, serviceRoleKey, email } = loadEnv();
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const userId = await findUserId(supabase, email);
  const organizationId = await resolveOrganizationId(supabase, userId);

  const slugOwner = check(
    await supabase.from("properties").select("id").eq("organization_id", organizationId).eq("slug", PROPERTY_SLUG).neq("id", PROPERTY_ID).maybeSingle<{ id: string }>(),
    "Checking slug availability",
  );
  if (slugOwner) throw new SeedError(`Slug "${PROPERTY_SLUG}" is already used by property ${slugOwner.id} in this organization.`);

  check(
    await supabase.from("properties").upsert(
      { id: PROPERTY_ID, organization_id: organizationId, name: "Tehran Villa", property_type: "villa", slug: PROPERTY_SLUG, created_by: userId },
      { onConflict: "id" },
    ),
    "Upserting property",
  );
  check(
    await supabase.from("property_members").upsert({ property_id: PROPERTY_ID, user_id: userId, role: "owner" }, { onConflict: "property_id,user_id" }),
    "Upserting property membership",
  );
  check(
    await supabase.from("hubs").upsert(
      { id: HUB_ID, property_id: PROPERTY_ID, name: "Tehran hub", hardware_id: HUB_HARDWARE_ID },
      { onConflict: "id" },
    ),
    "Upserting hub",
  );
  check(
    await supabase.from("devices").upsert(
      DEVICES.map(({ id, external_id, name, kind, room_name }) => ({ id, property_id: PROPERTY_ID, hub_id: HUB_ID, external_id, name, kind, room_name })),
      { onConflict: "id" },
    ),
    "Upserting devices",
  );

  const capabilityRows = DEVICES.flatMap((device) =>
    device.capabilities.map((cap) => ({
      property_id: PROPERTY_ID,
      device_id: device.id,
      capability: cap.capability,
      value_type: cap.value_type,
      min_value: cap.min_value ?? null,
      max_value: cap.max_value ?? null,
      step: cap.step ?? null,
      enum_values: cap.enum_values ?? null,
      unit: cap.unit ?? null,
      writable: cap.writable ?? true,
    })),
  );
  check(await supabase.from("device_capabilities").upsert(capabilityRows, { onConflict: "device_id,capability" }), "Upserting capabilities");

  // Initial state only: never overwrite values a device has since reported.
  const stateRows = DEVICES.flatMap((device) =>
    device.capabilities.map((cap) => ({ property_id: PROPERTY_ID, device_id: device.id, capability: cap.capability, value: cap.initial })),
  );
  check(
    await supabase.from("device_states").upsert(stateRows, { onConflict: "device_id,capability", ignoreDuplicates: true }),
    "Seeding initial device state",
  );

  console.log(
    `Phase 1 seed complete for ${email}: property "${PROPERTY_SLUG}" (${PROPERTY_ID}), hub ${HUB_ID}, ` +
      `${DEVICES.length} devices, ${capabilityRows.length} capabilities, ${stateRows.length} initial states.`,
  );
}

seed().catch((error: unknown) => {
  console.error(error instanceof SeedError ? `Seed blocked: ${error.message}` : error);
  process.exit(1);
});
