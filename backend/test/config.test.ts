import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("applies defaults when only DATABASE_URL is set", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://m2_api:pw@127.0.0.1:55432/m2smart" })).toEqual({
      nodeEnv: "development",
      devRoutes: false,
      devBoardSimulator: false,
      host: "127.0.0.1",
      port: 4000,
      databaseUrl: "postgres://m2_api:pw@127.0.0.1:55432/m2smart",
      databasePoolMax: 10,
      logLevel: "info",
      kratosPublicUrl: "http://127.0.0.1:4433",
      kratosWebhookSecret: null,
      broker: null,
    });
  });

  it("reads the boards' broker, and requires its account with MQTT_URL", () => {
    const base = { DATABASE_URL: "postgres://m2_api:pw@127.0.0.1:55432/m2smart", MQTT_URL: "mqtt://127.0.0.1:18830" };
    expect(loadConfig({ ...base, MQTT_USERNAME: "m2-api", MQTT_PASSWORD: "a-long-random-password" }).broker).toEqual({
      url: "mqtt://127.0.0.1:18830",
      username: "m2-api",
      password: "a-long-random-password",
    });
    expect(() => loadConfig(base)).toThrow(/MQTT_USERNAME/);
    expect(() => loadConfig({ ...base, MQTT_URL: "http://127.0.0.1:18830", MQTT_USERNAME: "m2-api", MQTT_PASSWORD: "a-long-random-password" })).toThrow(/MQTT_URL/);
  });

  it("enables development routes only when NODE_ENV=development is set explicitly", () => {
    const base = { DATABASE_URL: "postgres://m2_api:pw@127.0.0.1:55432/m2smart" };
    expect(loadConfig({ ...base, NODE_ENV: "development" }).devRoutes).toBe(true);
    expect(loadConfig(base).devRoutes).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: "production" }).devRoutes).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: "test" }).devRoutes).toBe(false);
  });

  it("runs the dev board simulator only in explicit development with the flag on", () => {
    const base = { DATABASE_URL: "postgres://m2_api:pw@127.0.0.1:55432/m2smart", M2SMART_DEV_BOARD_SIMULATOR: "true" };
    expect(loadConfig({ ...base, NODE_ENV: "development" }).devBoardSimulator).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: "production" }).devBoardSimulator).toBe(false);
    expect(loadConfig(base).devBoardSimulator).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: "development", M2SMART_DEV_BOARD_SIMULATOR: "false" }).devBoardSimulator).toBe(false);
    expect(() => loadConfig({ ...base, M2SMART_DEV_BOARD_SIMULATOR: "yes" })).toThrow(ConfigError);
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
