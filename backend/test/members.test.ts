/**
 * Home members and invitations against the dev database, as the API runs them: who may invite,
 * re-role and remove whom (canManageRole), invitations by mobile number, accepting and declining,
 * and that nothing of a home shows to people outside it.
 */
import type { HomeInvitation, MemberListResponse, MyInvitationListResponse, Property, PropertyListResponse } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncIdentity } from "../src/auth/identity-webhook";
import type { SessionCredential, SessionVerifier } from "../src/auth/session-verifier";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const USERS = {
  owner: ["7e5c0000-0000-4000-8000-000000000001", "+989120000001"],
  admin: ["7e5c0000-0000-4000-8000-000000000002", "+989120000002"],
  member: ["7e5c0000-0000-4000-8000-000000000003", "+989120000003"],
  guest: ["7e5c0000-0000-4000-8000-000000000004", "+989120000004"],
  stranger: ["7e5c0000-0000-4000-8000-000000000005", "+989120000005"],
} as const;
type UserKey = keyof typeof USERS;
const ids = Object.values(USERS).map(([id]) => id);

const verifier: SessionVerifier = {
  async verify(credential: SessionCredential) {
    const user = USERS[credential.value as UserKey];
    if (!user) return null;
    return { userId: user[0], sessionId: `s-${user[0]}`, expiresAt: new Date(Date.now() + 3_600_000), authMethods: ["code"], identity: { phone: user[1], email: null, name: null }, issuer: "cloud" };
  },
};

async function cleanup(): Promise<void> {
  await adminQuery("delete from public.properties where created_by = any($1::uuid[])", [ids]);
  await deleteUsers(ids);
}

describe("home members API", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;
  let home: Property;

  const call = async (user: UserKey | null, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
    const response = await app.inject({ method, url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };
  const base = () => `/v1/properties/${home.id}`;
  const invite = (user: UserKey, phone: string, role: string) => call(user, "POST", `${base()}/invitations`, { phone, role });
  const myInvitations = async (user: UserKey) => ((await call(user, "GET", "/v1/me/invitations")).body as MyInvitationListResponse).invitations;
  const accept = async (user: UserKey) => call(user, "POST", `/v1/me/invitations/${(await myInvitations(user))[0].id}/accept`);

  beforeAll(async () => {
    await cleanup();
    pool = createApiPool();
    app = buildServer({ logLevel: "silent" }, pool, { sessionVerifier: verifier });
    for (const [key, [id, phone]] of Object.entries(USERS)) await syncIdentity(pool, { id, phone, email: null, name: `P5 ${key}` });
    home = (await call("owner", "POST", "/v1/properties", { name: "Members home" })).body;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await cleanup();
  });

  it("requires a session", async () => {
    expect((await call(null, "GET", `${base()}/members`)).status).toBe(401);
    expect((await call(null, "GET", "/v1/me/invitations")).status).toBe(401);
  });

  it("invites by mobile number, in any form it is typed", async () => {
    const created = await invite("owner", "0912 000 0002", "admin");
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: expect.any(String), phone: "+989120000002", role: "admin", createdAt: expect.any(String) });
    expect((await invite("owner", "09120000002", "member")).status).toBe(409); // already invited
    expect((await invite("owner", "09120000001", "member")).status).toBe(409); // already a member
    for (const payload of [{ phone: "123", role: "member" }, { phone: "09120000009", role: "owner" }, { phone: "09120000009" }]) {
      expect((await call("owner", "POST", `${base()}/invitations`, payload)).status, JSON.stringify(payload)).toBe(400);
    }
  });

  it("shows an invitation only to its number, with the home and who invited", async () => {
    expect(await myInvitations("admin")).toEqual([{ id: expect.any(String), propertyName: "Members home", invitedBy: "P5 owner", role: "admin", createdAt: expect.any(String) }]);
    expect(await myInvitations("stranger")).toEqual([]);
    // Nobody else can accept or decline it.
    const id = (await myInvitations("admin"))[0].id;
    expect((await call("stranger", "POST", `/v1/me/invitations/${id}/accept`)).status).toBe(404);
    expect((await call("stranger", "DELETE", `/v1/me/invitations/${id}`)).status).toBe(404);
    expect((await call("stranger", "GET", `${base()}/members`)).status).toBe(404);
  });

  it("accepting joins the home with the invited role and deletes the invitation", async () => {
    const accepted = await accept("admin");
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ id: home.id, name: "Members home", role: "admin" });
    expect(((await call("admin", "GET", "/v1/properties")).body as PropertyListResponse).properties.map((item) => item.id)).toContain(home.id);
    expect(await myInvitations("admin")).toEqual([]);
    expect(await adminQuery("select 1 from public.property_invitations where property_id = $1", [home.id])).toEqual([]);
  });

  it("an admin invites members only", async () => {
    expect((await invite("admin", "09120000004", "admin")).status).toBe(403);
    expect((await invite("admin", "09120000003", "member")).status).toBe(201);
    expect((await accept("member")).body.role).toBe("member");
    expect((await invite("member", "09120000005", "member")).status).toBe(403);
  });

  it("owners and admins see everyone with their numbers; a member sees only themself", async () => {
    const list = async (user: UserKey) => (await call(user, "GET", `${base()}/members`)).body as MemberListResponse;
    expect((await list("owner")).members.map((member) => [member.name, member.phone, member.role, member.you])).toEqual([
      ["P5 owner", "+989120000001", "owner", true],
      ["P5 admin", "+989120000002", "admin", false],
      ["P5 member", "+989120000003", "member", false],
    ]);
    expect((await list("admin")).members).toHaveLength(3);
    expect(await list("member")).toEqual({ members: [{ userId: USERS.member[0], name: "P5 member", phone: "+989120000003", role: "member", you: true }], invitations: [] });
  });

  it("declining or cancelling deletes the invitation; an admin cannot cancel an admin's", async () => {
    const forAdmin = (await invite("owner", "09120000004", "admin")).body as HomeInvitation;
    expect((await call("admin", "DELETE", `${base()}/invitations/${forAdmin.id}`)).status).toBe(403);
    expect(((await call("admin", "GET", `${base()}/members`)).body as MemberListResponse).invitations.map((item) => item.id)).toEqual([forAdmin.id]);
    expect((await call("owner", "DELETE", `${base()}/invitations/${forAdmin.id}`)).status).toBe(204);

    await invite("admin", "09120000004", "member");
    expect((await call("guest", "DELETE", `/v1/me/invitations/${(await myInvitations("guest"))[0].id}`)).status).toBe(204);
    expect(await adminQuery("select 1 from public.property_invitations where property_id = $1", [home.id])).toEqual([]);
  });

  it("only the owner changes roles, never their own", async () => {
    expect((await call("admin", "PATCH", `${base()}/members/${USERS.member[0]}`, { role: "admin" })).status).toBe(403);
    expect((await call("owner", "PATCH", `${base()}/members/${USERS.owner[0]}`, { role: "member" })).status).toBe(403);
    expect((await call("owner", "PATCH", `${base()}/members/${USERS.member[0]}`, { role: "owner" })).status).toBe(400);
    const promoted = await call("owner", "PATCH", `${base()}/members/${USERS.member[0]}`, { role: "admin" });
    expect([promoted.status, promoted.body.role]).toEqual([200, "admin"]);
    expect((await call("owner", "PATCH", `${base()}/members/${USERS.member[0]}`, { role: "member" })).body.role).toBe("member");
  });

  it("removing and leaving", async () => {
    expect((await call("admin", "DELETE", `${base()}/members/${USERS.owner[0]}`)).status).toBe(403);
    expect((await call("member", "DELETE", `${base()}/members/${USERS.admin[0]}`)).status).toBe(403);
    expect((await call("owner", "DELETE", `${base()}/members/${USERS.owner[0]}`)).status).toBe(409); // the owner cannot leave
    expect((await call("admin", "DELETE", `${base()}/members/${USERS.member[0]}`)).status).toBe(204);
    expect((await call("member", "GET", `${base()}/members`)).status).toBe(404);
    expect((await call("admin", "DELETE", `${base()}/members/${USERS.admin[0]}`)).status).toBe(204); // leaves
    expect(((await call("owner", "GET", `${base()}/members`)).body as MemberListResponse).members.map((member) => member.role)).toEqual(["owner"]);
  });
});
