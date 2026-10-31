/**
 * Changing the mobile number against the dev database: it needs a recent sign-in, the code goes to
 * the new number, a wrong or late code does nothing, a number someone else has is refused, and the
 * right code moves the account (Kratos and the app's copy) to the new number.
 */
import type { MeResponse } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncIdentity } from "../src/auth/identity-webhook";
import type { IdentityAdmin } from "../src/auth/kratos-admin";
import type { SessionCredential, SessionVerifier } from "../src/auth/session-verifier";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const ME = "7e5e0000-0000-4000-8000-000000000001";
const OTHER = "7e5e0000-0000-4000-8000-000000000002";
const phones: Record<string, string> = { [ME]: "+989120000201", [OTHER]: "+989120000202" };
let signedInMinutesAgo = 1;

const verifier: SessionVerifier = {
  async verify(credential: SessionCredential) {
    const id = credential.value === "me" ? ME : credential.value === "other" ? OTHER : null;
    if (!id) return null;
    return {
      userId: id, sessionId: `s-${id}`, expiresAt: new Date(Date.now() + 3_600_000), authenticatedAt: new Date(Date.now() - signedInMinutesAgo * 60_000),
      authMethods: ["code"], identity: { phone: phones[id], email: null, name: "Phone tester" }, issuer: "cloud",
    };
  },
};
const kratosPhones: Array<[string, string]> = [];
const identityAdmin: IdentityAdmin = {
  setBlocked: async () => undefined,
  setPhone: async (id, phone) => {
    kratosPhones.push([id, phone]);
    phones[id] = phone;
    return true;
  },
  delete: async () => undefined,
};
const codes: Array<[string, string]> = [];
const sms = { sendCode: async (to: string, code: string) => void codes.push([to, code]), sendInvitation: async () => undefined };

describe("changing the mobile number", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;
  const call = async (user: "me" | "other" | null, url: string, payload?: object) => {
    const response = await app.inject({ method: url === "/v1/me" ? "GET" : "POST", url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };

  beforeAll(async () => {
    await deleteUsers([ME, OTHER]);
    pool = createApiPool();
    app = buildServer({ logLevel: "silent" }, pool, { sessionVerifier: verifier, identityAdmin, sms });
    await syncIdentity(pool, { id: ME, phone: phones[ME], email: null, name: "Phone tester" });
    await syncIdentity(pool, { id: OTHER, phone: phones[OTHER], email: null, name: "Other" });
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await deleteUsers([ME, OTHER]);
  });

  it("needs a session and a sign-in in the last 15 minutes", async () => {
    expect((await call(null, "/v1/me/phone", { phone: "09120000203" })).status).toBe(401);
    signedInMinutesAgo = 20;
    expect(await call("me", "/v1/me/phone", { phone: "09120000203" })).toEqual({ status: 403, body: { error: "reauth_required" } });
    expect((await call("me", "/v1/me/phone/verify", { code: "123456" })).status).toBe(403);
    signedInMinutesAgo = 1;
    expect(codes).toEqual([]);
  });

  it("refuses a bad number, the same number, and someone else's", async () => {
    for (const phone of ["123", "", "0912 000 0201"]) expect((await call("me", "/v1/me/phone", { phone })).status, phone).toBe(400);
    expect((await call("me", "/v1/me/phone", { phone: "09120000202" })).status).toBe(409);
    expect(codes).toEqual([]);
  });

  it("sends a code to the new number; a wrong code changes nothing", async () => {
    expect(await call("me", "/v1/me/phone", { phone: "0912 000 0203" })).toEqual({ status: 202, body: { phone: "+989120000203" } });
    expect(codes.at(-1)?.[0]).toBe("+989120000203");
    const wrong = codes.at(-1)![1] === "000000" ? "111111" : "000000";
    expect((await call("me", "/v1/me/phone/verify", { code: wrong })).status).toBe(400);
    expect((await call("me", "/v1/me/phone/verify", { code: "12" })).status).toBe(400);
    expect(kratosPhones).toEqual([]);
  });

  it("the right code moves sign-in and the account to the new number", async () => {
    expect(await call("me", "/v1/me/phone/verify", { code: codes.at(-1)![1] })).toEqual({ status: 200, body: { phone: "+989120000203" } });
    expect(kratosPhones).toEqual([[ME, "+989120000203"]]);
    expect(await adminQuery("select phone from auth.users where id = $1", [ME])).toEqual([{ phone: "+989120000203" }]);
    expect(((await call("me", "/v1/me")).body as MeResponse).user.phone).toBe("+989120000203");
    // The code works once.
    expect((await call("me", "/v1/me/phone/verify", { code: codes.at(-1)![1] })).status).toBe(404);
  });

  it("a code allows 5 tries", async () => {
    await call("other", "/v1/me/phone", { phone: "09120000204" });
    const right = codes.at(-1)![1];
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await call("other", "/v1/me/phone/verify", { code: wrong })).status).toBe(400);
    expect((await call("other", "/v1/me/phone/verify", { code: right })).status).toBe(404);
  });

  it("at most 5 codes an hour", async () => {
    const before = codes.length;
    for (let i = 0; i < 4; i++) expect((await call("other", "/v1/me/phone", { phone: "09120000204" })).status).toBe(202);
    expect((await call("other", "/v1/me/phone", { phone: "09120000204" })).status).toBe(429);
    expect(codes.length - before).toBe(4);
  });
});
