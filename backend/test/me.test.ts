import type { MeResponse } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncIdentity } from "../src/auth/identity-webhook";
import type { SessionCredential, SessionVerifier, VerifiedSession } from "../src/auth/session-verifier";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const NEW_USER = "7e5a0000-0000-4000-8000-000000000021";
const OTHER_USER = "7e5a0000-0000-4000-8000-000000000022";

function sessionFor(userId: string, phone: string, name: string | null): VerifiedSession {
  return {
    userId,
    sessionId: `session-${userId}`,
    expiresAt: new Date(Date.now() + 3_600_000),
    authMethods: ["code"],
    identity: { phone, email: null, name },
    issuer: "cloud",
  };
}

/** Fake verifier: token "new" is NEW_USER, "down" simulates Kratos being unavailable. */
const fakeVerifier: SessionVerifier = {
  async verify(credential: SessionCredential) {
    if (credential.value === "down") throw new Error("kratos unreachable");
    if (credential.value === "new") return sessionFor(NEW_USER, "+989120000021", "Me Test");
    return null;
  },
};

describe("GET /v1/me", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await deleteUsers([NEW_USER, OTHER_USER]);
    pool = createApiPool();
    app = buildServer({ logLevel: "silent" }, pool, { sessionVerifier: fakeVerifier });
    // Another user whose organization must never show up for NEW_USER.
    await syncIdentity(pool, { id: OTHER_USER, phone: "+989120000022", email: null, name: "Other" });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await deleteUsers([NEW_USER, OTHER_USER]);
  });

  const me = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/v1/me", headers });

  it("is 401 without a credential", async () => {
    const response = await me({});
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("is 401 for an invalid or expired session", async () => {
    expect((await me({ authorization: "Bearer expired" })).statusCode).toBe(401);
  });

  it("is 503 when the auth service cannot answer", async () => {
    const response = await me({ authorization: "Bearer down" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "auth_unavailable" });
  });

  it("recovers a missed webhook: creates the user and returns their personal organization", async () => {
    const before = await adminQuery("select 1 from auth.users where id = $1", [NEW_USER]);
    expect(before).toHaveLength(0);

    const response = await me({ cookie: "ory_kratos_session=new" });
    expect(response.statusCode).toBe(200);
    const body = response.json<MeResponse>();
    expect(body.user).toEqual({ id: NEW_USER, displayName: "Me Test", phone: "+989120000021", email: null });
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0]).toMatchObject({ name: "Me Test's home", role: "owner" });
    expect(body.session.authMethods).toEqual(["code"]);
  });

  it("returns only the caller's own organizations (RLS) and stays idempotent", async () => {
    const body = (await me({ "x-session-token": "new" })).json<MeResponse>();
    expect(body.organizations.map((organization) => organization.name)).toEqual(["Me Test's home"]);
    const [count] = await adminQuery<{ n: number }>("select count(*)::int as n from public.organization_members where user_id = $1", [NEW_USER]);
    expect(count.n).toBe(1);
  });
});
