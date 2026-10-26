/**
 * Live updates against the dev database: a change in the database (here a reported state) reaches
 * an open stream of that home as `data: changed`, and only that home's streams; the stream needs a
 * session and membership like any other route.
 */
import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionCredential, SessionVerifier } from "../src/auth/session-verifier";
import { startHomeEvents, type HomeEvents } from "../src/realtime/home-events";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, createTenants, dropTenants, PROPERTY_A, PROPERTY_B, USER_A, USER_B } from "./fixtures";

const USERS: Record<string, string> = { a: USER_A, b: USER_B };
const verifier: SessionVerifier = {
  async verify(credential: SessionCredential) {
    const userId = USERS[credential.value];
    return userId ? { userId, sessionId: `s-${userId}`, expiresAt: new Date(Date.now() + 3_600_000), authMethods: ["code"], identity: { phone: null, email: null, name: null }, issuer: "cloud" } : null;
  },
};
const quiet = { warn() {}, info() {}, error() {} } as unknown as FastifyBaseLogger;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("live updates (GET /v1/properties/:id/events)", () => {
  let pool: Pool;
  let events: HomeEvents;
  let app: ReturnType<typeof buildServer>;
  let base: string;

  /** Opens a stream; collects what arrives in `received`. */
  const open = async (user: string | null, propertyId: string) => {
    const controller = new AbortController();
    const response = await fetch(`${base}/v1/properties/${propertyId}/events`, { headers: user ? { authorization: `Bearer ${user}` } : {}, signal: controller.signal });
    const stream = { status: response.status, type: response.headers.get("content-type"), received: "", close: () => controller.abort() };
    if (response.ok && response.body) {
      void (async () => {
        const decoder = new TextDecoder();
        try {
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) stream.received += decoder.decode(chunk);
        } catch {
          // Aborted by the test.
        }
      })();
    }
    return stream;
  };
  const report = (propertyId: string) => adminQuery("update public.device_states set value = to_jsonb(not value::text::boolean), reported_at = now() where property_id = $1", [propertyId]);

  beforeAll(async () => {
    await createTenants();
    pool = createApiPool();
    events = startHomeEvents(pool, quiet);
    app = buildServer({ logLevel: "silent" }, pool, { sessionVerifier: verifier, homeEvents: events });
    base = await app.listen({ host: "127.0.0.1", port: 0 });
    await sleep(500); // the listener connects in the background
  });

  afterAll(async () => {
    await app.close();
    await events.stop();
    await pool.end();
    await dropTenants();
  });

  it("needs a session and membership", async () => {
    expect((await open(null, PROPERTY_A)).status).toBe(401);
    expect((await open("b", PROPERTY_A)).status).toBe(404);
    expect((await open("a", "not-a-uuid")).status).toBe(404);
  });

  it("tells a home's open pages when something there changes, and only them", async () => {
    const mine = await open("a", PROPERTY_A);
    const other = await open("b", PROPERTY_B);
    expect([mine.status, mine.type]).toEqual([200, "text/event-stream; charset=utf-8"]);
    await sleep(200);

    await report(PROPERTY_A);
    await sleep(600);
    expect(mine.received).toContain("data: changed");
    expect(other.received).not.toContain("data: changed");

    await report(PROPERTY_B);
    await sleep(600);
    expect(other.received).toContain("data: changed");
    expect(mine.received.match(/data: changed/g)).toHaveLength(1);
    mine.close();
    other.close();
  });

  it("sends a burst of changes as one notice", async () => {
    const mine = await open("a", PROPERTY_A);
    await sleep(200);
    await Promise.all([report(PROPERTY_A), report(PROPERTY_A), report(PROPERTY_A)]);
    await sleep(600);
    expect(mine.received.match(/data: changed/g)?.length ?? 0).toBe(1);
    mine.close();
  });
});
