import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthUnavailableError, createKratosVerifier } from "../src/auth/kratos-verifier";

const IDENTITY_ID = "7e5a0000-0000-4000-8000-0000000000aa";

function whoami(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    active: true,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    authentication_methods: [{ method: "code" }],
    identity: { id: IDENTITY_ID, traits: { phone: "+989121234567", name: "Sara" } },
    ...overrides,
  };
}

/** Fake Kratos public API: answers /sessions/whoami with whatever the test sets. */
describe("Kratos session verifier", () => {
  let server: Server;
  let baseUrl: string;
  let reply: { status: number; body: unknown } = { status: 200, body: whoami() };
  let lastHeaders: IncomingHttpHeaders = {};

  beforeAll(async () => {
    server = createServer((request, response) => {
      lastHeaders = request.headers;
      if (request.url !== "/sessions/whoami") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    reply = { status: 200, body: whoami() };
    lastHeaders = {};
  });

  it("returns the session for a valid token and sends it as X-Session-Token", async () => {
    const session = await createKratosVerifier(baseUrl).verify({ kind: "token", value: "tok-1" });
    expect(session).toMatchObject({
      userId: IDENTITY_ID,
      sessionId: "session-1",
      authMethods: ["code"],
      identity: { phone: "+989121234567", email: null, name: "Sara" },
      issuer: "cloud",
    });
    expect(lastHeaders["x-session-token"]).toBe("tok-1");
    expect(lastHeaders.cookie).toBeUndefined();
  });

  it("forwards only the Kratos session cookie", async () => {
    await createKratosVerifier(baseUrl).verify({ kind: "cookie", value: "abc" });
    expect(lastHeaders.cookie).toBe("ory_kratos_session=abc");
  });

  it("treats 401 (invalid or expired session) as signed out", async () => {
    reply = { status: 401, body: { error: { code: 401 } } };
    expect(await createKratosVerifier(baseUrl).verify({ kind: "token", value: "bad" })).toBeNull();
  });

  it("treats 403 (higher assurance level required) as signed out", async () => {
    reply = { status: 403, body: { error: { code: 403 } } };
    expect(await createKratosVerifier(baseUrl).verify({ kind: "token", value: "aal" })).toBeNull();
  });

  it("rejects an inactive session", async () => {
    reply = { status: 200, body: whoami({ active: false }) };
    expect(await createKratosVerifier(baseUrl).verify({ kind: "token", value: "x" })).toBeNull();
  });

  it("rejects a session whose expiry has passed", async () => {
    reply = { status: 200, body: whoami({ expires_at: new Date(Date.now() - 1_000).toISOString() }) };
    expect(await createKratosVerifier(baseUrl).verify({ kind: "token", value: "x" })).toBeNull();
  });

  it("reports Kratos errors as unavailable, not as signed out", async () => {
    reply = { status: 500, body: "boom" };
    await expect(createKratosVerifier(baseUrl).verify({ kind: "token", value: "x" })).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("reports an unexpected body as unavailable", async () => {
    reply = { status: 200, body: { id: "s", active: true } };
    await expect(createKratosVerifier(baseUrl).verify({ kind: "token", value: "x" })).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("reports an unreachable Kratos as unavailable", async () => {
    await expect(createKratosVerifier("http://127.0.0.1:1").verify({ kind: "token", value: "x" })).rejects.toBeInstanceOf(AuthUnavailableError);
  });
});
