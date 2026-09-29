import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { credentialFromRequest, withSessionCache, type SessionCredential, type VerifiedSession } from "../src/auth/session-verifier";

const session: VerifiedSession = {
  userId: "7e5a0000-0000-4000-8000-000000000001",
  sessionId: "s1",
  expiresAt: new Date(Date.now() + 3_600_000),
  authMethods: ["code"],
  identity: { phone: "+989121234567", email: null, name: null },
  issuer: "cloud",
};

describe("credentialFromRequest", () => {
  const app = Fastify();
  app.get("/c", async (request) => ({ credential: credentialFromRequest(request) }));
  afterAll(() => app.close());

  const read = async (headers: Record<string, string>) =>
    (await app.inject({ method: "GET", url: "/c", headers })).json<{ credential: SessionCredential | null }>().credential;

  it("reads a bearer token", async () => {
    expect(await read({ authorization: "Bearer abc123" })).toEqual({ kind: "token", value: "abc123" });
  });

  it("reads X-Session-Token", async () => {
    expect(await read({ "x-session-token": "tok" })).toEqual({ kind: "token", value: "tok" });
  });

  it("reads only the Kratos session cookie out of the cookie header", async () => {
    expect(await read({ cookie: "theme=dark; ory_kratos_session=MTY5; other=1" })).toEqual({ kind: "cookie", value: "MTY5" });
  });

  it("returns null without a credential", async () => {
    expect(await read({ cookie: "theme=dark" })).toBeNull();
  });
});

describe("withSessionCache", () => {
  function counting(result: VerifiedSession | null) {
    const calls: SessionCredential[] = [];
    return { calls, verifier: { verify: async (credential: SessionCredential) => (calls.push(credential), result) } };
  }

  it("asks the provider once per credential within the TTL", async () => {
    let now = 0;
    const inner = counting(session);
    const cached = withSessionCache(inner.verifier, { ttlMs: 30_000, now: () => now });
    await cached.verify({ kind: "token", value: "a" });
    now = 29_000;
    await cached.verify({ kind: "token", value: "a" });
    expect(inner.calls).toHaveLength(1);

    await cached.verify({ kind: "token", value: "b" });
    expect(inner.calls).toHaveLength(2);

    now = 31_000;
    await cached.verify({ kind: "token", value: "a" });
    expect(inner.calls).toHaveLength(3);
  });

  it("never trusts a cached session past its expiry", async () => {
    let now = Date.now();
    const shortLived = { ...session, expiresAt: new Date(now + 1_000) };
    const inner = counting(shortLived);
    const cached = withSessionCache(inner.verifier, { ttlMs: 30_000, now: () => now });
    await cached.verify({ kind: "token", value: "a" });
    now += 2_000;
    await cached.verify({ kind: "token", value: "a" });
    expect(inner.calls).toHaveLength(2);
  });

  it("remembers invalid credentials only briefly", async () => {
    let now = 0;
    const inner = counting(null);
    const cached = withSessionCache(inner.verifier, { negativeTtlMs: 5_000, now: () => now });
    expect(await cached.verify({ kind: "cookie", value: "bad" })).toBeNull();
    now = 4_000;
    await cached.verify({ kind: "cookie", value: "bad" });
    expect(inner.calls).toHaveLength(1);
    now = 6_000;
    await cached.verify({ kind: "cookie", value: "bad" });
    expect(inner.calls).toHaveLength(2);
  });

  it("keeps cookie and token with the same value apart", async () => {
    const inner = counting(session);
    const cached = withSessionCache(inner.verifier);
    await cached.verify({ kind: "cookie", value: "same" });
    await cached.verify({ kind: "token", value: "same" });
    expect(inner.calls).toHaveLength(2);
  });
});
