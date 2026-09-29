import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server";

describe("POST /internal/dev/sms", () => {
  // The route never touches the database; the pool is never connected.
  const pool = new Pool({ connectionString: "postgres://m2_api:unused@127.0.0.1:1/m2smart" });
  const dev = buildServer({ logLevel: "silent", devRoutes: true }, pool);
  const prod = buildServer({ logLevel: "silent", devRoutes: false }, pool);
  const sms = { to: "+989121234567", text: "Your login code is: 123456", template: "login_code_valid" };

  afterAll(async () => {
    await dev.close();
    await prod.close();
    await pool.end();
  });

  it("accepts and logs an SMS in development", async () => {
    const response = await dev.inject({ method: "POST", url: "/internal/dev/sms", payload: sms });
    expect(response.statusCode).toBe(204);
  });

  it("rejects a malformed message", async () => {
    const response = await dev.inject({ method: "POST", url: "/internal/dev/sms", payload: { text: "no recipient" } });
    expect(response.statusCode).toBe(400);
  });

  it("does not exist when development routes are off", async () => {
    const response = await prod.inject({ method: "POST", url: "/internal/dev/sms", payload: sms });
    expect(response.statusCode).toBe(404);
  });
});
