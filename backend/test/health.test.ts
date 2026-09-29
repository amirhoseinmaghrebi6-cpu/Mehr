import type { HealthResponse } from "@m2smart/contracts";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server";
import { createApiPool } from "./fixtures";

describe("health endpoints", () => {
  const livePool = createApiPool(1);
  // Nothing listens on port 1, so every connection attempt fails immediately.
  const deadPool = new Pool({ connectionString: "postgres://m2_api:unused@127.0.0.1:1/m2smart", connectionTimeoutMillis: 1_000 });
  const up = buildServer({ logLevel: "silent" }, livePool);
  const down = buildServer({ logLevel: "silent" }, deadPool);

  afterAll(async () => {
    await up.close();
    await down.close();
    await livePool.end();
    await deadPool.end();
  });

  it("GET /healthz is 200 without touching the database", async () => {
    const response = await down.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>()).toEqual({ status: "ok" });
  });

  it("GET /readyz is 200 when the database answers", async () => {
    const response = await up.inject({ method: "GET", url: "/readyz" });
    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>()).toEqual({ status: "ok", checks: { database: "ok" } });
  });

  it("GET /readyz is 503 when the database is unreachable", async () => {
    const response = await down.inject({ method: "GET", url: "/readyz" });
    expect(response.statusCode).toBe(503);
    expect(response.json<HealthResponse>()).toEqual({ status: "unavailable", checks: { database: "unavailable" } });
  });
});
