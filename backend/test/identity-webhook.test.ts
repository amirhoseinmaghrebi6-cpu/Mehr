import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isInternalAddress } from "../src/auth/identity-webhook";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const SECRET = "test-webhook-secret-0123456789abcdef";
const USER = "7e5a0000-0000-4000-8000-000000000011";
const payload = { identity_id: USER, phone: "+989120000011", name: "Webhook User" };

describe("isInternalAddress", () => {
  it.each(["127.0.0.1", "::1", "10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.65.1", "::ffff:192.168.1.5", "fd00::1"])("accepts %s", (ip) => {
    expect(isInternalAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "172.32.0.1", "185.1.2.3", "2001:db8::1", "::ffff:8.8.8.8", "not-an-ip"])("refuses %s", (ip) => {
    expect(isInternalAddress(ip)).toBe(false);
  });
});

describe("POST /internal/kratos/identity", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await deleteUsers([USER]);
    pool = createApiPool();
    app = buildServer({ logLevel: "silent", kratosWebhookSecret: SECRET }, pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await deleteUsers([USER]);
  });

  const send = (options: { secret?: string; remoteAddress?: string; body?: unknown }) =>
    app.inject({
      method: "POST",
      url: "/internal/kratos/identity",
      remoteAddress: options.remoteAddress ?? "127.0.0.1",
      headers: options.secret === undefined ? {} : { "x-webhook-secret": options.secret },
      payload: (options.body ?? payload) as object,
    });

  it("refuses calls from outside the internal network, even with the secret", async () => {
    expect((await send({ secret: SECRET, remoteAddress: "8.8.8.8" })).statusCode).toBe(403);
  });

  it("refuses a missing or wrong secret", async () => {
    expect((await send({})).statusCode).toBe(401);
    expect((await send({ secret: "wrong-secret-wrong-secret-wrong-secret" })).statusCode).toBe(401);
  });

  it("rejects a malformed body", async () => {
    expect((await send({ secret: SECRET, body: { identity_id: "not-a-uuid", phone: "+98" } })).statusCode).toBe(400);
  });

  it("creates the user, profile and personal organization", async () => {
    expect((await send({ secret: SECRET })).statusCode).toBe(200);
    const [row] = await adminQuery<{ phone: string; full_name: string; orgs: number }>(
      `select u.phone, p.full_name,
         (select count(*)::int from public.organization_members m where m.user_id = u.id and m.role = 'owner') as orgs
       from auth.users u join public.profiles p on p.user_id = u.id where u.id = $1`,
      [USER],
    );
    expect(row).toEqual({ phone: "+989120000011", full_name: "Webhook User", orgs: 1 });
  });

  it("is idempotent: a replayed webhook creates nothing new", async () => {
    expect((await send({ secret: SECRET })).statusCode).toBe(200);
    expect((await send({ secret: SECRET })).statusCode).toBe(200);
    const [row] = await adminQuery<{ users: number; orgs: number }>(
      `select (select count(*)::int from auth.users where id = $1) as users,
              (select count(*)::int from public.organization_members where user_id = $1) as orgs`,
      [USER],
    );
    expect(row).toEqual({ users: 1, orgs: 1 });
  });

  it("refuses every password registration with a Kratos flow-interrupt message", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/kratos/registration/password",
      remoteAddress: "127.0.0.1",
      headers: { "x-webhook-secret": SECRET },
      payload: { identity_id: USER, phone: "+989120000099" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().messages[0].messages[0]).toMatchObject({ id: 4100001, type: "error" });
  });

  it("guards the password-registration hook with the same secret", async () => {
    const response = await app.inject({ method: "POST", url: "/internal/kratos/registration/password", payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it("does not exist when no secret is configured", async () => {
    const open = buildServer({ logLevel: "silent" }, pool);
    const response = await open.inject({ method: "POST", url: "/internal/kratos/identity", payload });
    await open.close();
    expect(response.statusCode).toBe(404);
  });
});
