/**
 * A home's activity: the commands of the last 24 hours with who asked, for members only.
 */
import type { ActivityResponse } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionCredential, SessionVerifier } from "../src/auth/session-verifier";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, createTenants, DEVICE_A, dropTenants, PROPERTY_A, USER_A, USER_B } from "./fixtures";

const USERS: Record<string, string> = { a: USER_A, b: USER_B };
const verifier: SessionVerifier = {
  async verify(credential: SessionCredential) {
    const userId = USERS[credential.value];
    return userId ? { userId, sessionId: `s-${userId}`, expiresAt: new Date(Date.now() + 3_600_000), authMethods: ["code"], identity: { phone: null, email: null, name: null }, issuer: "cloud" } : null;
  },
};

describe("GET /v1/properties/:id/activity", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;
  const get = async (user: string | null, propertyId = PROPERTY_A) => {
    const response = await app.inject({ method: "GET", url: `/v1/properties/${propertyId}/activity`, headers: user ? { authorization: `Bearer ${user}` } : {} });
    return { status: response.statusCode, body: response.json() as ActivityResponse };
  };

  beforeAll(async () => {
    await createTenants();
    pool = createApiPool();
    app = buildServer({ logLevel: "silent" }, pool, { sessionVerifier: verifier });
    await adminQuery(
      `insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key, requested_by, status, created_at, completed_at, applied_at)
       values ($1, $2, 'power', 'true', 'activity-recent-1', $3, 'applied', now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour'),
              ($1, $2, 'power', 'false', 'activity-old-1', $3, 'applied', now() - interval '25 hours', now() - interval '25 hours', now() - interval '25 hours')`,
      [PROPERTY_A, DEVICE_A, USER_A],
    );
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await dropTenants();
  });

  it("lists the last day's commands with who asked", async () => {
    const { status, body } = await get("a");
    expect(status).toBe(200);
    expect(body.entries).toEqual([
      { id: expect.any(String), deviceId: DEVICE_A, deviceName: "Test light", capability: "power", targetValue: true, status: "applied", createdAt: expect.any(String), completedAt: expect.any(String), requestedBy: "api-test-a", scenario: null },
    ]);
  });

  it("shows nothing to people outside the home", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get("b")).status).toBe(404);
  });
});
