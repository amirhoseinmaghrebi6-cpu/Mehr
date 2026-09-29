/**
 * Local dev seed for self-hosted PostgreSQL: a dev user, the "tehran" property, one hub and the
 * prototype devices, written with plain `pg`.
 *
 * Idempotent: every row has a fixed id or natural key, and reported device state is only
 * inserted if missing, never overwritten. Runs in one transaction.
 *
 * Usage: pnpm db:seed   (after pnpm db:migrate)
 *
 * Reads backend/.env.local: DATABASE_ADMIN_URL (required), SEED_DEV_USER_EMAIL (optional).
 * Refuses to run when NODE_ENV=production.
 */
import type { Client } from "pg";
import { connectAdmin, runTool, ToolError } from "../src/db/admin";

// Fixed, non-secret identifiers so reruns converge on the same rows.
const DEV_USER_ID = "5eed0000-0000-4000-8000-000000000001";
const DEFAULT_DEV_USER_EMAIL = "dev@m2smart.local";
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

async function ensureDevUser(client: Client, email: string): Promise<void> {
  const { rows } = await client.query<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
  if (rows.length && rows[0].id !== DEV_USER_ID) {
    throw new ToolError(`${email} already belongs to auth user ${rows[0].id}, not the dev user. Set SEED_DEV_USER_EMAIL to another address.`);
  }
  // The on_auth_user_created trigger creates the profile, organization and owner membership.
  await client.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict (id) do nothing",
    [DEV_USER_ID, email, { full_name: "M2smart Dev" }],
  );
}

async function resolveOrganizationId(client: Client): Promise<string> {
  const existing = await client.query<{ organization_id: string }>("select organization_id from public.properties where id = $1", [PROPERTY_ID]);
  const memberships = await client.query<{ organization_id: string }>(
    "select organization_id from public.organization_members where user_id = $1 and role = 'owner' order by created_at",
    [DEV_USER_ID],
  );
  const owned = memberships.rows.map((row) => row.organization_id);

  if (existing.rows.length) {
    const organizationId = existing.rows[0].organization_id;
    if (!owned.includes(organizationId)) {
      throw new ToolError(`Property ${PROPERTY_ID} already belongs to an organization the dev user does not own. Refusing to move it.`);
    }
    return organizationId;
  }
  if (!owned.length) {
    throw new ToolError("Dev user owns no organization. The on_auth_user_created trigger should have created one; run pnpm db:migrate.");
  }
  return owned[0];
}

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new ToolError("The dev seed never runs with NODE_ENV=production.");

  const client = await connectAdmin();
  const email = (process.env.SEED_DEV_USER_EMAIL ?? DEFAULT_DEV_USER_EMAIL).trim().toLowerCase();
  let capabilityCount = 0;

  try {
    await client.query("begin");
    await ensureDevUser(client, email);

    // App rows are written the way the backend will write them: as service_role.
    await client.query("set local role service_role");
    const organizationId = await resolveOrganizationId(client);

    const slugOwner = await client.query<{ id: string }>(
      "select id from public.properties where organization_id = $1 and slug = $2 and id <> $3",
      [organizationId, PROPERTY_SLUG, PROPERTY_ID],
    );
    if (slugOwner.rows.length) throw new ToolError(`Slug "${PROPERTY_SLUG}" is already used by property ${slugOwner.rows[0].id} in this organization.`);

    await client.query(
      `insert into public.properties (id, organization_id, name, property_type, slug, created_by)
       values ($1, $2, 'Tehran Villa', 'villa', $3, $4)
       on conflict (id) do update set name = excluded.name, property_type = excluded.property_type, slug = excluded.slug`,
      [PROPERTY_ID, organizationId, PROPERTY_SLUG, DEV_USER_ID],
    );
    await client.query(
      `insert into public.property_members (property_id, user_id, role) values ($1, $2, 'owner')
       on conflict (property_id, user_id) do update set role = excluded.role`,
      [PROPERTY_ID, DEV_USER_ID],
    );
    await client.query(
      `insert into public.hubs (id, property_id, name, hardware_id) values ($1, $2, 'Tehran hub', $3)
       on conflict (id) do update set name = excluded.name, hardware_id = excluded.hardware_id`,
      [HUB_ID, PROPERTY_ID, HUB_HARDWARE_ID],
    );

    for (const device of DEVICES) {
      await client.query(
        `insert into public.devices (id, property_id, hub_id, external_id, name, kind, room_name)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set external_id = excluded.external_id, name = excluded.name, kind = excluded.kind, room_name = excluded.room_name`,
        [device.id, PROPERTY_ID, HUB_ID, device.external_id, device.name, device.kind, device.room_name],
      );

      for (const cap of device.capabilities) {
        await client.query(
          `insert into public.device_capabilities (property_id, device_id, capability, value_type, min_value, max_value, step, enum_values, unit, writable)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (device_id, capability) do update set value_type = excluded.value_type, min_value = excluded.min_value,
             max_value = excluded.max_value, step = excluded.step, enum_values = excluded.enum_values, unit = excluded.unit, writable = excluded.writable`,
          [PROPERTY_ID, device.id, cap.capability, cap.value_type, cap.min_value ?? null, cap.max_value ?? null, cap.step ?? null,
            cap.enum_values ?? null, cap.unit ?? null, cap.writable ?? true],
        );
        // Initial state only: never overwrite values a device has since reported.
        await client.query(
          `insert into public.device_states (property_id, device_id, capability, value) values ($1, $2, $3, $4)
           on conflict (device_id, capability) do nothing`,
          [PROPERTY_ID, device.id, cap.capability, JSON.stringify(cap.initial)],
        );
        capabilityCount++;
      }
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  console.log(
    `Dev seed complete for ${email} (${DEV_USER_ID}): property "${PROPERTY_SLUG}" (${PROPERTY_ID}), hub ${HUB_ID}, ` +
      `${DEVICES.length} devices, ${capabilityCount} capabilities and initial states.`,
  );
}

runTool(seed);
