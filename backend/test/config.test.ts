import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("applies defaults when only DATABASE_URL is set", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://m2_api:pw@127.0.0.1:55432/m2smart" })).toEqual({
      nodeEnv: "development",
      host: "127.0.0.1",
      port: 4000,
      databaseUrl: "postgres://m2_api:pw@127.0.0.1:55432/m2smart",
      databasePoolMax: 10,
      logLevel: "info",
    });
  });

  it("names every invalid variable", () => {
    expect(() => loadConfig({ API_PORT: "not-a-port" })).toThrow(ConfigError);
    try {
      loadConfig({ API_PORT: "not-a-port" });
    } catch (error) {
      expect((error as Error).message).toMatch(/DATABASE_URL/);
      expect((error as Error).message).toMatch(/API_PORT/);
    }
  });

  it("never echoes a secret value in the error", () => {
    const secret = "mysql://root:super-secret-password@db";
    expect(() => loadConfig({ DATABASE_URL: secret })).toThrow(ConfigError);
    try {
      loadConfig({ DATABASE_URL: secret });
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-password");
    }
  });
});
