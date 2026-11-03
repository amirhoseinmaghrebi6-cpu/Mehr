/**
 * The home's energy use: an energy meter's running total becomes hourly and daily use (all meters
 * of the home added up), bad readings and restarts are handled, other devices' totals are not
 * kept, only members read it, and old rows go.
 */
import type { EnergyResponse } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionCredential, SessionVerifier } from "../src/auth/session-verifier";
import { reportDeviceState } from "../src/devices/reports";
import { cleanUp } from "../src/maintenance/cleanup";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, createTenants, dropTenants, PROPERTY_A, USER_A, USER_B } from "./fixtures";

const USERS: Record<string, string> = { a: USER_A, b: USER_B };
const verifier: SessionVerifier = {
  async verify(credential: SessionCredential) {
    const userId = USERS[credential.value];
    return userId ? { userId, sessionId: `s-${userId}`, expiresAt: new Date(Date.now() + 3_600_000), authMethods: ["code"], identity: { phone: null, email: null, name: null }, issuer: "cloud" } : null;
  },
};
const PHASE_1 = "7e570004-0000-4000-8000-0000000000e1";
const PHASE_2 = "7e570004-0000-4000-8000-0000000000e2";
const SOCKET = "7e570004-0000-4000-8000-0000000000e3";

describe("GET /v1/properties/:id/energy", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;
  const get = async (user: string | null) => {
    const response = await app.inject({ method: "GET", url: `/v1/properties/${PROPERTY_A}/energy`, headers: user ? { authorization: `Bearer ${user}` } : {} });
    return { status: response.statusCode, body: response.json() as EnergyResponse };
  };
  const totals = async () => {
    const { body } = await get("a");
    return { hours: body.hours.reduce((sum, hour) => sum + hour.kwh, 0), days: body.days.reduce((sum, day) => sum + day.kwh, 0) };
  };
  const report = (device: string, kwh: number) => reportDeviceState(pool, device, "energy_kwh", kwh);

  beforeAll(async () => {
    await createTenants();
    pool = createApiPool();
    app = buildServer({ logLevel: "silent" }, pool, { sessionVerifier: verifier });
    await adminQuery("update public.properties set time_zone = 'Asia/Tehran' where id = $1", [PROPERTY_A]);
    for (const [id, type, name] of [[PHASE_1, "energy_meter", "Phase 1"], [PHASE_2, "energy_meter", "Phase 2"], [SOCKET, "socket", "Socket"]]) {
      await adminQuery(
        `insert into public.devices (id, property_id, hub_id, external_id, name, kind, device_type)
         select $1, $2, hub.id, $3, $4, 'sensor', $5 from public.hubs as hub where hub.property_id = $2`,
        [id, PROPERTY_A, `energy-${name}`, name, type],
      );
      await adminQuery("insert into public.device_capabilities (property_id, device_id, capability, value_type, min_value) values ($1, $2, 'energy_kwh', 'number', 0)", [PROPERTY_A, id]);
    }
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await dropTenants();
  });

  it("turns a meter's running total into this hour's and today's use", async () => {
    expect(await report(PHASE_1, 100)).toBe("stored");
    expect(await totals()).toEqual({ hours: 0, days: 0 }); // the first total only sets the starting point
    await report(PHASE_1, 101.5);
    expect(await totals()).toEqual({ hours: 1.5, days: 1.5 });
    const { body } = await get("a");
    expect(body.hours).toEqual([{ start: expect.stringMatching(/:00:00\.000Z$/), kwh: 1.5 }]);
    const [{ today }] = await adminQuery<{ today: string }>("select to_char((now() at time zone 'Asia/Tehran')::date, 'YYYY-MM-DD') as today");
    expect(body.days).toEqual([{ start: today, kwh: 1.5 }]);
  });

  it("counts a restarted meter's whole total, and ignores a reading no home could use", async () => {
    await report(PHASE_1, 0.4); // started again from zero
    expect(await totals()).toEqual({ hours: 1.9, days: 1.9 });
    await report(PHASE_1, 900); // a bad reading
    expect(await totals()).toEqual({ hours: 1.9, days: 1.9 });
    await report(PHASE_1, 901);
    expect(await totals()).toEqual({ hours: 2.9, days: 2.9 });
  });

  it("adds the home's meters together and keeps no other device's total", async () => {
    await report(PHASE_2, 50);
    await report(PHASE_2, 52);
    await report(SOCKET, 10);
    await report(SOCKET, 15);
    expect(await totals()).toEqual({ hours: 4.9, days: 4.9 });
    expect(await adminQuery("select 1 from public.energy_daily where device_id = $1 union all select 1 from public.energy_hourly where device_id = $1", [SOCKET])).toEqual([]);
  });

  it("shows nothing to people outside the home", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get("b")).status).toBe(404);
  });

  it("keeps hours for 7 days and days for 12 months", async () => {
    await adminQuery("insert into public.energy_hourly (device_id, property_id, hour, energy_kwh) values ($1, $2, date_trunc('hour', now()) - interval '9 days', 3)", [PHASE_2, PROPERTY_A]);
    await adminQuery("insert into public.energy_daily (device_id, property_id, day, energy_kwh, last_reading_kwh) values ($1, $2, current_date - 400, 3, 0), ($1, $2, current_date - 30, 7, 0)", [PHASE_2, PROPERTY_A]);
    expect((await get("a")).body.days.length).toBe(2); // the one from 400 days ago is not shown

    await cleanUp(pool);
    const left = await adminQuery<{ kind: string; age: number }>(
      `select 'hour' as kind, extract(day from now() - hour)::int as age from public.energy_hourly where property_id = $1
       union all select 'day', current_date - day from public.energy_daily where property_id = $1 order by 1, 2`,
      [PROPERTY_A],
    );
    expect(left.filter((row) => row.kind === "hour" && row.age > 7)).toEqual([]);
    expect(left.filter((row) => row.kind === "day").map((row) => row.age).sort((a, b) => a - b)).toEqual([0, 0, 30]);
    expect(await totals()).toEqual({ hours: 4.9, days: 11.9 });
  });
});
