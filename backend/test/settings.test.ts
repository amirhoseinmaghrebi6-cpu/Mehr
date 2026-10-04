/**
 * GET/PATCH /v1/me/settings and the settings in /v1/me, against the dev database. Each user only
 * ever reads and changes their own preferences.
 */
import type { MeResponse, UserSettings } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncIdentity } from "../src/auth/identity-webhook";
import type { SessionCredential, SessionVerifier, VerifiedSession } from "../src/auth/session-verifier";
import { buildServer } from "../src/server";
import { createApiPool, deleteUsers } from "./fixtures";

const USERS = { alice: "7e5d0000-0000-4000-8000-000000000001", bob: "7e5d0000-0000-4000-8000-000000000002" } as const;
type UserKey = keyof typeof USERS;

const verifier: SessionVerifier = {
  async verify(credential: SessionCredential): Promise<VerifiedSession | null> {
    const userId = USERS[credential.value as UserKey];
    return userId
      ? { userId, sessionId: `s-${userId}`, expiresAt: new Date(Date.now() + 3_600_000), authMethods: ["code"], identity: { phone: null, email: null, name: credential.value }, issuer: "cloud" }
      : null;
  },
};

describe("user settings", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;
  const call = async (user: UserKey | null, method: "GET" | "PATCH", url: string, payload?: object) => {
    const response = await app.inject({ method, url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.json() };
  };

  beforeAll(async () => {
    await deleteUsers(Object.values(USERS));
    pool = createApiPool();
    app = buildServer({ logLevel: "silent" }, pool, { sessionVerifier: verifier });
    await syncIdentity(pool, { id: USERS.alice, phone: null, email: null, name: "Alice" });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await deleteUsers(Object.values(USERS));
  });

  it("requires a session", async () => {
    expect((await call(null, "GET", "/v1/me/settings")).status).toBe(401);
    expect((await call(null, "PATCH", "/v1/me/settings", { language: "fa" })).status).toBe(401);
  });

  it("starts with English, Solar Hijri and Celsius, also for a user the webhook missed", async () => {
    expect((await call("alice", "GET", "/v1/me/settings")).body).toEqual({ language: "en", calendar: "solar_hijri", temperatureUnit: "celsius" });
    expect((await call("bob", "GET", "/v1/me/settings")).body).toEqual({ language: "en", calendar: "solar_hijri", temperatureUnit: "celsius" });
  });

  it("saves changes and returns them in /v1/me too", async () => {
    const saved = await call("alice", "PATCH", "/v1/me/settings", { language: "ar", temperatureUnit: "fahrenheit" });
    expect(saved).toEqual({ status: 200, body: { language: "ar", calendar: "solar_hijri", temperatureUnit: "fahrenheit" } satisfies UserSettings });
    expect((await call("alice", "PATCH", "/v1/me/settings", { calendar: "gregorian" })).body).toEqual({ language: "ar", calendar: "gregorian", temperatureUnit: "fahrenheit" });
    expect(((await call("alice", "GET", "/v1/me")).body as MeResponse).settings).toEqual({ language: "ar", calendar: "gregorian", temperatureUnit: "fahrenheit" });
  });

  it("never touches another user's settings", async () => {
    expect((await call("bob", "GET", "/v1/me/settings")).body).toEqual({ language: "en", calendar: "solar_hijri", temperatureUnit: "celsius" });
  });

  it("rejects unknown or empty changes", async () => {
    for (const payload of [{}, { language: "de" }, { calendar: "lunar_hijri" }, { temperatureUnit: "kelvin" }, { userId: USERS.bob }]) {
      const response = await call("alice", "PATCH", "/v1/me/settings", payload);
      expect([response.status, response.body], JSON.stringify(payload)).toEqual([400, { error: "invalid_request" }]);
    }
  });
});
