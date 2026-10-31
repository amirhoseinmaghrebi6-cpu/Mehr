/**
 * The operator's panel against the dev database: only the numbers in platformAdmins get in; it
 * lists people and boards without anything from inside a home; blocking signs a user out of the
 * whole API; deleting removes the account in Kratos, every home the user owns, and the broker
 * accounts of those homes' boards. Operators are never blocked or deleted.
 */
import type { AdminBoardListResponse, AdminOverview, AdminUserListResponse, MeResponse, Property } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncIdentity } from "../src/auth/identity-webhook";
import type { IdentityAdmin } from "../src/auth/kratos-admin";
import { createKratosAdmin, IdentityAdminError } from "../src/auth/kratos-admin";
import { loadConfig } from "../src/config";
import type { SessionCredential, SessionVerifier } from "../src/auth/session-verifier";
import type { Broker } from "../src/broker/broker";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const USERS = {
  operator: ["7e5d0000-0000-4000-8000-000000000001", "+989120000101"],
  operator2: ["7e5d0000-0000-4000-8000-000000000002", "+989120000102"],
  owner: ["7e5d0000-0000-4000-8000-000000000003", "+989120000103"],
  member: ["7e5d0000-0000-4000-8000-000000000004", "+989120000104"],
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

const kratosCalls: string[] = [];
let kratosDown = false;
const identityAdmin: IdentityAdmin = {
  async setBlocked(id, blocked) {
    if (kratosDown) throw new IdentityAdminError("down");
    kratosCalls.push(`${blocked ? "block" : "unblock"} ${id}`);
  },
  async setPhone() {
    return true;
  },
  async delete(id) {
    if (kratosDown) throw new IdentityAdminError("down");
    kratosCalls.push(`delete ${id}`);
  },
};
const removedBoards: string[] = [];
const SECRET = "w".repeat(40);
const codesSent: string[] = [];
const sms = { sendCode: async (to: string) => void codesSent.push(to), sendInvitation: async () => undefined };
const broker = { removeBoard: async (id: string) => void removedBoards.push(id) } as unknown as Broker;

async function cleanup(): Promise<void> {
  await adminQuery("delete from public.properties where created_by = any($1::uuid[])", [ids]);
  await deleteUsers(ids);
}

describe("operator's panel API", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;
  let home: Property;
  let boardId: string;

  const call = async (user: UserKey | null, method: "GET" | "PATCH" | "DELETE" | "POST", url: string, payload?: unknown) => {
    const response = await app.inject({ method, url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };

  beforeAll(async () => {
    await cleanup();
    pool = createApiPool();
    app = buildServer({ logLevel: "silent", platformAdmins: [USERS.operator[1], USERS.operator2[1]], kratosWebhookSecret: SECRET }, pool, { sessionVerifier: verifier, identityAdmin, broker: () => broker, smsReady: true, sms });
    for (const [key, [id, phone]] of Object.entries(USERS)) await syncIdentity(pool, { id, phone, email: null, name: `Admin test ${key}` });
    home = (await call("owner", "POST", "/v1/properties", { name: "Secret home name" })).body;
    await adminQuery("insert into public.property_members (property_id, user_id, role) values ($1, $2, 'member')", [home.id, USERS.member[0]]);
    await adminQuery("insert into public.hubs (property_id, name, hardware_id) values ($1, 'Hub', $2)", [home.id, `test-admin-hub-${home.id}`]);
    [{ id: boardId }] = await adminQuery<{ id: string }>("select public.provision_controller((select id from public.hubs where property_id = $1), 'sample-air-rev-b', $2, 'Board') as id", [home.id, `TEST-ADMIN-${home.id.slice(0, 8)}`]);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await cleanup();
  });

  it("lets only operators in, and tells the app who they are", async () => {
    expect((await call(null, "GET", "/v1/admin/overview")).status).toBe(401);
    for (const url of ["/v1/admin/overview", "/v1/admin/users", "/v1/admin/boards"]) expect((await call("owner", "GET", url)).status, url).toBe(403);
    expect((await call("owner", "PATCH", `/v1/admin/users/${USERS.member[0]}`, { blocked: true })).status).toBe(403);
    expect((await call("owner", "DELETE", `/v1/admin/users/${USERS.member[0]}`)).status).toBe(403);
    expect(((await call("operator", "GET", "/v1/me")).body as MeResponse).user.platformAdmin).toBe(true);
    expect(((await call("owner", "GET", "/v1/me")).body as MeResponse).user.platformAdmin).toBe(false);
  });

  it("shows counts, people and boards, but nothing from inside a home", async () => {
    const overview = (await call("operator", "GET", "/v1/admin/overview")).body as AdminOverview;
    expect(overview.users).toBeGreaterThanOrEqual(4);
    expect(overview.boards).toBeGreaterThanOrEqual(1);
    expect(overview.services).toEqual({ database: true, broker: true, sms: true, accounts: true });

    const found = (await call("operator", "GET", "/v1/admin/users?search=0000103")).body as AdminUserListResponse;
    expect(found.total).toBe(1);
    expect(found.users[0]).toEqual({ id: USERS.owner[0], name: "Admin test owner", phone: USERS.owner[1], createdAt: expect.any(String), blocked: false, homesOwned: 1, homesJoined: 0, platformAdmin: false });
    const byName = (await call("operator", "GET", "/v1/admin/users?search=Admin%20test%20member")).body as AdminUserListResponse;
    expect(byName.users.map((user) => [user.id, user.homesJoined])).toEqual([[USERS.member[0], 1]]);
    expect(((await call("operator", "GET", "/v1/admin/users?search=0000101")).body as AdminUserListResponse).users[0].platformAdmin).toBe(true);

    // The dev database may hold more boards than a page: look through every page.
    const boards: AdminBoardListResponse = { boards: [], total: 0 };
    for (let offset = 0; offset === 0 || offset < boards.total; offset += 50) {
      const pageOf = (await call("operator", "GET", `/v1/admin/boards?offset=${offset}`)).body as AdminBoardListResponse;
      boards.boards.push(...pageOf.boards);
      boards.total = pageOf.total;
    }
    expect(boards.boards).toHaveLength(boards.total);
    const board = boards.boards.find((entry) => entry.id === boardId);
    expect(board).toMatchObject({ hardwareUid: expect.stringMatching(/^TEST-ADMIN-/), online: false, ownerName: "Admin test owner", ownerPhone: USERS.owner[1] });
    expect(JSON.stringify(boards) + JSON.stringify(found)).not.toContain("Secret home name");
  });

  it("never blocks or deletes an operator, and needs Kratos to change anything", async () => {
    expect((await call("operator", "PATCH", `/v1/admin/users/${USERS.operator[0]}`, { blocked: true })).status).toBe(409);
    expect((await call("operator", "DELETE", `/v1/admin/users/${USERS.operator2[0]}`)).status).toBe(409);
    expect((await call("operator", "PATCH", "/v1/admin/users/7e5d0000-0000-4000-8000-0000000000ff", { blocked: true })).status).toBe(404);
    expect((await call("operator", "PATCH", "/v1/admin/users/nope", { blocked: true })).status).toBe(404);
    expect((await call("operator", "PATCH", `/v1/admin/users/${USERS.member[0]}`, { blocked: "yes" })).status).toBe(400);
    kratosDown = true;
    expect((await call("operator", "PATCH", `/v1/admin/users/${USERS.member[0]}`, { blocked: true })).status).toBe(503);
    kratosDown = false;
    expect((await call("member", "GET", "/v1/me")).status).toBe(200); // nothing changed
    expect(kratosCalls).toEqual([]);
  });

  it("blocking signs the user out of the whole API; unblocking lets them back", async () => {
    expect((await call("operator", "PATCH", `/v1/admin/users/${USERS.member[0]}`, { blocked: true })).status).toBe(204);
    expect(kratosCalls.at(-1)).toBe(`block ${USERS.member[0]}`);
    expect((await call("member", "GET", "/v1/me")).status).toBe(401);
    expect((await call("member", "GET", `/v1/properties/${home.id}/devices`)).status).toBe(401);
    expect(((await call("operator", "GET", "/v1/admin/users?search=0000104")).body as AdminUserListResponse).users[0].blocked).toBe(true);
    expect(((await call("operator", "GET", "/v1/admin/overview")).body as AdminOverview).blockedUsers).toBeGreaterThanOrEqual(1);
    // The sign-in page asks whether a number is blocked, from the internal network only.
    const blockedCheck = (phone: string, remoteAddress = "127.0.0.1") => app.inject({ method: "POST", url: "/internal/accounts/blocked", remoteAddress, payload: { phone } });
    expect((await blockedCheck("0912 000 0104")).json()).toEqual({ blocked: true });
    expect((await blockedCheck(USERS.owner[1])).json()).toEqual({ blocked: false });
    expect((await blockedCheck("+989129999990")).json()).toEqual({ blocked: false });
    expect((await blockedCheck("nope")).statusCode).toBe(400);
    expect((await blockedCheck(USERS.member[1], "203.0.113.5")).statusCode).toBe(403);
    // Kratos still asks to send a sign-in code to a disabled identity: it is dropped, not paid for.
    const code = await app.inject({ method: "POST", url: "/internal/kratos/sms", headers: { "x-webhook-secret": SECRET }, payload: { to: USERS.member[1], code: "123456" } });
    expect(code.statusCode).toBe(204);
    expect(codesSent).toEqual([]);

    expect((await call("operator", "PATCH", `/v1/admin/users/${USERS.member[0]}`, { blocked: false })).status).toBe(204);
    expect(kratosCalls.at(-1)).toBe(`unblock ${USERS.member[0]}`);
    expect((await call("member", "GET", "/v1/me")).status).toBe(200);
  });

  it("deleting removes the account, the homes it owns and their boards' broker accounts", async () => {
    expect((await call("operator", "DELETE", `/v1/admin/users/${USERS.owner[0]}`)).status).toBe(204);
    expect(kratosCalls.at(-1)).toBe(`delete ${USERS.owner[0]}`);
    expect(removedBoards).toEqual([boardId]);
    expect(await adminQuery("select 1 from auth.users where id = $1", [USERS.owner[0]])).toEqual([]);
    expect(await adminQuery("select 1 from public.properties where id = $1", [home.id])).toEqual([]);
    expect(await adminQuery("select 1 from public.controllers where id = $1", [boardId])).toEqual([]);
    expect(await adminQuery("select 1 from public.organization_members where user_id = $1", [USERS.owner[0]])).toEqual([]);
    // The member of that home keeps their account, without the home.
    expect((await call("member", "GET", "/v1/properties")).body.properties).toEqual([]);
    expect((await call("operator", "DELETE", `/v1/admin/users/${USERS.owner[0]}`)).status).toBe(404);
  });
});

describe("operator settings and the Kratos admin client", () => {
  const base = { DATABASE_URL: "postgres://m2_api:pw@127.0.0.1:15432/m2smart" };
  it("reads the operators' numbers in any usual form", () => {
    expect(loadConfig(base).platformAdmins).toEqual([]);
    expect(loadConfig({ ...base, PLATFORM_ADMIN_PHONES: "0912 000 0101, +989120000102" }).platformAdmins).toEqual(["+989120000101", "+989120000102"]);
    expect(() => loadConfig({ ...base, PLATFORM_ADMIN_PHONES: "0912, nope" })).toThrow(/PLATFORM_ADMIN_PHONES/);
  });

  it("blocks by making the identity inactive and ending its sessions; moves the phone; deletes it", async () => {
    const calls: Array<[string, string, unknown]> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push([init.method!, url, init.body ? JSON.parse(init.body as string) : null]);
      return new Response(null, { status: init.method === "PATCH" ? 200 : url.endsWith("/sessions") ? 404 : 204 });
    }) as unknown as typeof fetch;
    const kratos = createKratosAdmin("http://kratos:4434", fetchImpl);
    await kratos.setBlocked("id-1", true);
    await kratos.setBlocked("id-1", false);
    await kratos.delete("id-1");
    expect(calls).toEqual([
      ["PATCH", "http://kratos:4434/admin/identities/id-1", [{ op: "replace", path: "/state", value: "inactive" }]],
      ["DELETE", "http://kratos:4434/admin/identities/id-1/sessions", null],
      ["PATCH", "http://kratos:4434/admin/identities/id-1", [{ op: "replace", path: "/state", value: "active" }]],
      ["DELETE", "http://kratos:4434/admin/identities/id-1", null],
    ]);
    // A new phone number moves the trait; 409 means another identity has that number.
    calls.length = 0;
    expect(await kratos.setPhone("id-1", "+989120000999")).toBe(true);
    expect(calls).toEqual([["PATCH", "http://kratos:4434/admin/identities/id-1", [{ op: "replace", path: "/traits/phone", value: "+989120000999" }]]]);
    const taken = createKratosAdmin("http://kratos:4434", (async () => new Response(null, { status: 409 })) as unknown as typeof fetch);
    expect(await taken.setPhone("id-1", "+989120000999")).toBe(false);
    const refusing = createKratosAdmin("http://kratos:4434", (async () => new Response(null, { status: 500 })) as unknown as typeof fetch);
    await expect(refusing.delete("id-1")).rejects.toBeInstanceOf(IdentityAdminError);
  });
});
