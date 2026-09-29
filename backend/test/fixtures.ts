/**
 * Two isolated tenants for integration tests: user A owns property A, user B owns property B,
 * each with one hub, device, capability and reported state. Created through the superuser
 * connection (DATABASE_ADMIN_URL) and removed afterwards; ids are fixed and test-only.
 *
 * Requires the dev stack and a migrated database: pnpm infra:up && pnpm db:migrate
 */
import { Client, Pool } from "pg";
import { loadBackendEnv } from "../src/env";

export const USER_A = "7e570000-0000-4000-8000-00000000000a";
export const USER_B = "7e570000-0000-4000-8000-00000000000b";
export const PROPERTY_A = "7e570001-0000-4000-8000-00000000000a";
export const PROPERTY_B = "7e570001-0000-4000-8000-00000000000b";
export const DEVICE_A = "7e570003-0000-4000-8000-00000000000a";
export const DEVICE_B = "7e570003-0000-4000-8000-00000000000b";

const TENANTS = [
  { user: USER_A, email: "api-test-a@test.local", property: PROPERTY_A, hub: "7e570002-0000-4000-8000-00000000000a", device: DEVICE_A },
  { user: USER_B, email: "api-test-b@test.local", property: PROPERTY_B, hub: "7e570002-0000-4000-8000-00000000000b", device: DEVICE_B },
];

function requireEnv(name: string): string {
  loadBackendEnv();
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Add it to backend/.env.local (see backend/.env.example).`);
  return value;
}

/** Pool logged in as m2_api, exactly as the API connects. */
export function createApiPool(max = 4): Pool {
  return new Pool({ connectionString: requireEnv("DATABASE_URL"), max, application_name: "m2smart-api-test" });
}

async function withAdmin(work: (admin: Client) => Promise<void>): Promise<void> {
  const admin = new Client({ connectionString: requireEnv("DATABASE_ADMIN_URL"), application_name: "m2smart-api-test-admin" });
  await admin.connect();
  try {
    await work(admin);
  } finally {
    await admin.end();
  }
}

async function deleteTenants(admin: Client): Promise<void> {
  const users = TENANTS.map((tenant) => tenant.user);
  // Properties first (created_by is ON DELETE RESTRICT); hubs, devices and states cascade.
  await admin.query("delete from public.properties where created_by = any($1::uuid[])", [users]);
  await admin.query(
    "delete from public.organizations where id in (select organization_id from public.organization_members where user_id = any($1::uuid[]))",
    [users],
  );
  await admin.query("delete from auth.users where id = any($1::uuid[])", [users]);
}

export async function createTenants(): Promise<void> {
  await withAdmin(async (admin) => {
    await admin.query("begin");
    await deleteTenants(admin);
    for (const tenant of TENANTS) {
      // The sign-up trigger creates the profile, organization and owner membership.
      await admin.query("insert into auth.users (id, email) values ($1, $2)", [tenant.user, tenant.email]);
      await admin.query(
        `insert into public.properties (id, organization_id, name, created_by)
         select $1, organization_id, 'API test property', $2 from public.organization_members where user_id = $2`,
        [tenant.property, tenant.user],
      );
      await admin.query("insert into public.property_members (property_id, user_id, role) values ($1, $2, 'owner')", [tenant.property, tenant.user]);
      await admin.query("insert into public.hubs (id, property_id, name, hardware_id) values ($1, $2, 'Test hub', $3)", [
        tenant.hub, tenant.property, `api-test-${tenant.hub}`,
      ]);
      await admin.query(
        "insert into public.devices (id, property_id, hub_id, external_id, name, kind) values ($1, $2, $3, 'light', 'Test light', 'light')",
        [tenant.device, tenant.property, tenant.hub],
      );
      await admin.query(
        "insert into public.device_capabilities (property_id, device_id, capability, value_type) values ($1, $2, 'power', 'boolean')",
        [tenant.property, tenant.device],
      );
      await admin.query("insert into public.device_states (property_id, device_id, capability, value) values ($1, $2, 'power', 'false')", [
        tenant.property, tenant.device,
      ]);
    }
    await admin.query("commit");
  });
}

export async function dropTenants(): Promise<void> {
  await withAdmin(deleteTenants);
}

/** Removes test users and their personal organizations (users must own no properties). */
export async function deleteUsers(ids: string[]): Promise<void> {
  await withAdmin(async (admin) => {
    await admin.query(
      "delete from public.organizations where id in (select organization_id from public.organization_members where user_id = any($1::uuid[]))",
      [ids],
    );
    await admin.query("delete from auth.users where id = any($1::uuid[])", [ids]);
  });
}

/** Superuser read for assertions. */
export async function adminQuery<R extends Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<R[]> {
  let rows: R[] = [];
  await withAdmin(async (admin) => {
    rows = (await admin.query(sql, values)).rows as R[];
  });
  return rows;
}
