/**
 * /v1/properties and /v1/properties/:id/rooms against the dev database, as the API runs them.
 * Two homes with separate users: nothing of home A may be visible to or changeable by user B, and
 * each role may do exactly what packages/contracts/src/permissions.ts allows.
 */
import type { Property, PropertyListResponse, Room, RoomListResponse } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncIdentity } from "../src/auth/identity-webhook";
import type { SessionCredential, SessionVerifier, VerifiedSession } from "../src/auth/session-verifier";
import { MAX_HOMES_PER_USER } from "../src/http/homes";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const USERS = {
  ownerA: "7e5b0000-0000-4000-8000-000000000001",
  adminA: "7e5b0000-0000-4000-8000-000000000002",
  memberA: "7e5b0000-0000-4000-8000-000000000003",
  ownerB: "7e5b0000-0000-4000-8000-000000000004",
  fresh: "7e5b0000-0000-4000-8000-000000000005",
} as const;
type UserKey = keyof typeof USERS;
const ALL_USERS = Object.values(USERS);

function sessionFor(userId: string): VerifiedSession {
  return {
    userId,
    sessionId: `session-${userId}`,
    expiresAt: new Date(Date.now() + 3_600_000),
    authMethods: ["code"],
    identity: { phone: null, email: null, name: null },
    issuer: "cloud",
  };
}

/** The bearer token is the user key (e.g. "ownerA"). */
const verifier: SessionVerifier = {
  async verify(credential: SessionCredential) {
    const userId = USERS[credential.value as UserKey];
    return userId ? sessionFor(userId) : null;
  },
};

async function cleanup(): Promise<void> {
  await adminQuery("delete from public.properties where created_by = any($1::uuid[])", [ALL_USERS]);
  await deleteUsers(ALL_USERS);
}

describe("homes and rooms API", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;
  let homeA: Property;
  let homeB: Property;
  let roomB: Room;

  const call = async (user: UserKey | null, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
    const response = await app.inject({
      method,
      url,
      headers: user ? { authorization: `Bearer ${user}` } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };

  beforeAll(async () => {
    await cleanup();
    pool = createApiPool();
    app = buildServer({ logLevel: "silent" }, pool, { sessionVerifier: verifier });
    for (const [key, id] of Object.entries(USERS)) await syncIdentity(pool, { id, phone: null, email: null, name: `P3 ${key}` });

    homeA = (await call("ownerA", "POST", "/v1/properties", { name: "Home A", type: "villa", address: "Tehran", coverPhoto: "exterior" })).body;
    homeB = (await call("ownerB", "POST", "/v1/properties", { name: "Home B" })).body;
    roomB = (await call("ownerB", "POST", `/v1/properties/${homeB.id}/rooms`, { name: "Living room" })).body;
    await adminQuery(
      "insert into public.property_members (property_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')",
      [homeA.id, USERS.adminA, USERS.memberA],
    );
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await cleanup();
  });

  it("requires a session on every route", async () => {
    for (const [method, url] of [
      ["GET", "/v1/properties"],
      ["POST", "/v1/properties"],
      ["PATCH", `/v1/properties/${homeA.id}`],
      ["DELETE", `/v1/properties/${homeA.id}`],
      ["GET", `/v1/properties/${homeA.id}/rooms`],
      ["POST", `/v1/properties/${homeA.id}/rooms`],
    ] as const) {
      expect((await call(null, method, url, method === "GET" || method === "DELETE" ? undefined : {})).status, `${method} ${url}`).toBe(401);
    }
  });

  describe("homes", () => {
    it("creates a home with the caller as owner", () => {
      expect(homeA).toEqual({ id: expect.any(String), name: "Home A", type: "villa", address: "Tehran", coverPhoto: "exterior", role: "owner" });
      expect(homeB).toMatchObject({ name: "Home B", type: "house", address: "", coverPhoto: "living", role: "owner" });
    });

    it("lists only the homes the user belongs to, with their role", async () => {
      const list = async (user: UserKey) => ((await call(user, "GET", "/v1/properties")).body as PropertyListResponse).properties;
      expect((await list("ownerA")).map((home) => [home.id, home.role])).toEqual([[homeA.id, "owner"]]);
      expect((await list("adminA")).map((home) => [home.id, home.role])).toEqual([[homeA.id, "admin"]]);
      expect((await list("memberA")).map((home) => [home.id, home.role])).toEqual([[homeA.id, "member"]]);
      expect((await list("ownerB")).map((home) => home.id)).toEqual([homeB.id]);
      expect(await list("fresh")).toEqual([]);
    });

    it("rejects invalid input", async () => {
      for (const payload of [{}, { name: "  " }, { name: "x".repeat(81) }, { name: "A", organizationId: homeB.id }, { name: "A", coverPhoto: "https://x.test/a.jpg" }]) {
        const response = await call("fresh", "POST", "/v1/properties", payload);
        expect(response.status, JSON.stringify(payload)).toBe(400);
        expect(response.body).toEqual({ error: "invalid_request" });
      }
      expect((await call("ownerA", "PATCH", `/v1/properties/${homeA.id}`, {})).status).toBe(400);
    });

    it("lets owners and admins edit a home, not members", async () => {
      const edited = await call("adminA", "PATCH", `/v1/properties/${homeA.id}`, { name: "Home A (edited)" });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ id: homeA.id, name: "Home A (edited)", type: "villa", address: "Tehran", role: "admin" });
      expect((await call("memberA", "PATCH", `/v1/properties/${homeA.id}`, { name: "Nope" })).status).toBe(403);
    });

    it("hides other homes entirely (404, never 403)", async () => {
      expect((await call("ownerB", "PATCH", `/v1/properties/${homeA.id}`, { name: "Hijack" })).status).toBe(404);
      expect((await call("ownerB", "DELETE", `/v1/properties/${homeA.id}`)).status).toBe(404);
      expect((await call("ownerB", "GET", `/v1/properties/${homeA.id}/rooms`)).status).toBe(404);
      expect((await call("ownerB", "POST", `/v1/properties/${homeA.id}/rooms`, { name: "Spy" })).status).toBe(404);
      expect((await call("ownerA", "GET", "/v1/properties/not-a-uuid/rooms")).status).toBe(404);
      const [row] = await adminQuery<{ name: string }>("select name from public.properties where id = $1", [homeA.id]);
      expect(row.name).toBe("Home A (edited)");
    });

    it("lets only the owner delete a home", async () => {
      expect((await call("memberA", "DELETE", `/v1/properties/${homeA.id}`)).status).toBe(403);
      expect((await call("adminA", "DELETE", `/v1/properties/${homeA.id}`)).status).toBe(403);
      const extra = (await call("ownerA", "POST", "/v1/properties", { name: "Short-lived" })).body as Property;
      expect((await call("ownerA", "DELETE", `/v1/properties/${extra.id}`)).status).toBe(204);
      expect((await call("ownerA", "DELETE", `/v1/properties/${extra.id}`)).status).toBe(404);
    });

    it(`limits a user to ${MAX_HOMES_PER_USER} homes`, async () => {
      await adminQuery(
        `with homes as (
           insert into public.properties (organization_id, name, created_by)
           select membership.organization_id, 'Bulk ' || n, $1
           from public.organization_members as membership, generate_series(1, $2) as n
           where membership.user_id = $1
           returning id
         )
         insert into public.property_members (property_id, user_id, role) select id, $1, 'owner' from homes`,
        [USERS.fresh, MAX_HOMES_PER_USER],
      );
      const response = await call("fresh", "POST", "/v1/properties", { name: "One too many" });
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "conflict" });
    });
  });

  describe("rooms", () => {
    let kitchen: Room;

    it("lets admins add rooms, not members", async () => {
      const created = await call("adminA", "POST", `/v1/properties/${homeA.id}/rooms`, { name: "Kitchen", photo: "kitchen" });
      expect(created.status).toBe(201);
      kitchen = created.body;
      expect(kitchen).toEqual({ id: expect.any(String), name: "Kitchen", photo: "kitchen", sortOrder: 0 });
      expect((await call("ownerA", "POST", `/v1/properties/${homeA.id}/rooms`, { name: "Hall" })).body).toMatchObject({ sortOrder: 1 });
      expect((await call("memberA", "POST", `/v1/properties/${homeA.id}/rooms`, { name: "Attic" })).status).toBe(403);
    });

    it("lists a home's rooms for every member, in order", async () => {
      const rooms = ((await call("memberA", "GET", `/v1/properties/${homeA.id}/rooms`)).body as RoomListResponse).rooms;
      expect(rooms.map((room) => room.name)).toEqual(["Kitchen", "Hall"]);
    });

    it("keeps room names unique per home, ignoring case and spaces", async () => {
      expect((await call("ownerA", "POST", `/v1/properties/${homeA.id}/rooms`, { name: "  KITCHEN " })).status).toBe(409);
      expect((await call("ownerA", "PATCH", `/v1/properties/${homeA.id}/rooms/${kitchen.id}`, { name: "hall" })).status).toBe(409);
      expect((await call("ownerB", "POST", `/v1/properties/${homeB.id}/rooms`, { name: "Kitchen" })).status).toBe(201);
    });

    it("renames and reorders rooms", async () => {
      const updated = await call("adminA", "PATCH", `/v1/properties/${homeA.id}/rooms/${kitchen.id}`, { name: "Open kitchen", sortOrder: 5 });
      expect(updated.status).toBe(200);
      expect(updated.body).toEqual({ id: kitchen.id, name: "Open kitchen", photo: "kitchen", sortOrder: 5 });
      expect((await call("memberA", "PATCH", `/v1/properties/${homeA.id}/rooms/${kitchen.id}`, { name: "Nope" })).status).toBe(403);
    });

    it("never touches another home's room through this home's path", async () => {
      expect((await call("ownerA", "PATCH", `/v1/properties/${homeA.id}/rooms/${roomB.id}`, { name: "Hijack" })).status).toBe(404);
      expect((await call("ownerA", "DELETE", `/v1/properties/${homeA.id}/rooms/${roomB.id}`)).status).toBe(404);
      const [row] = await adminQuery<{ name: string }>("select name from public.rooms where id = $1", [roomB.id]);
      expect(row.name).toBe("Living room");
    });

    it("deletes rooms (admins and owners only)", async () => {
      expect((await call("memberA", "DELETE", `/v1/properties/${homeA.id}/rooms/${kitchen.id}`)).status).toBe(403);
      expect((await call("adminA", "DELETE", `/v1/properties/${homeA.id}/rooms/${kitchen.id}`)).status).toBe(204);
      expect((await call("adminA", "DELETE", `/v1/properties/${homeA.id}/rooms/${kitchen.id}`)).status).toBe(404);
    });
  });

  it("answers malformed requests and unknown routes with the API's error body", async () => {
    const auth = { authorization: "Bearer ownerA" };
    const emptyJson = await app.inject({ method: "DELETE", url: `/v1/properties/${homeB.id}`, headers: { ...auth, "content-type": "application/json" } });
    expect([emptyJson.statusCode, emptyJson.json()]).toEqual([400, { error: "invalid_request" }]);
    const badJson = await app.inject({ method: "POST", url: "/v1/properties", headers: { ...auth, "content-type": "application/json" }, payload: "{not json" });
    expect([badJson.statusCode, badJson.json()]).toEqual([400, { error: "invalid_request" }]);
    const unknown = await app.inject({ method: "GET", url: "/v1/nothing-here", headers: auth });
    expect([unknown.statusCode, unknown.json()]).toEqual([404, { error: "not_found" }]);
  });

  it("removes the home from every member's list when the owner deletes it", async () => {
    expect((await call("ownerA", "DELETE", `/v1/properties/${homeA.id}`)).status).toBe(204);
    for (const user of ["ownerA", "adminA", "memberA"] as const) {
      expect(((await call(user, "GET", "/v1/properties")).body as PropertyListResponse).properties.map((home) => home.id)).not.toContain(homeA.id);
    }
    const rooms = await adminQuery("select 1 from public.rooms where property_id = $1", [homeA.id]);
    expect(rooms).toHaveLength(0);
  });
});
