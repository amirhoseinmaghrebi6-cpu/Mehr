import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  // Must connect as m2_api: a NOINHERIT, non-superuser role without BYPASSRLS.
  DATABASE_URL: z
    .string({ error: "is required (postgres://m2_api:<password>@host:port/db)" })
    .regex(/^postgres(ql)?:\/\//, { error: "must be a postgres:// URL" }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Kratos public API, used to check sessions (/sessions/whoami). Never the admin API.
  KRATOS_PUBLIC_URL: z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).default("http://127.0.0.1:4433"),
  // Shared secret Kratos sends with the identity webhook. Without it the webhook route is off.
  KRATOS_WEBHOOK_SECRET: z.string().min(32, { error: "must be at least 32 characters" }).optional(),
  // The MQTT broker the ESP32 boards connect to, and the API's account on it. Without MQTT_URL the
  // API runs with no board connection (boards then never come online).
  MQTT_URL: z.url({ protocol: /^mqtts?$/, error: "must be an mqtt:// or mqtts:// URL" }).optional(),
  MQTT_USERNAME: z.string().min(1).optional(),
  MQTT_PASSWORD: z.string().min(16, { error: "must be at least 16 characters" }).optional(),
  // Development only: simulated hub and ESP32 boards confirm commands (src/dev/hub-simulator.ts).
  M2SMART_DEV_HUB_SIMULATOR: z.enum(["true", "false"]).default("false"),
});

export type Config = {
  nodeEnv: "development" | "test" | "production";
  /**
   * Development-only routes (e.g. POST /internal/dev/sms). True only when NODE_ENV is set to
   * "development" explicitly; the NODE_ENV default does not count, so a forgotten variable in
   * production never opens them.
   */
  devRoutes: boolean;
  /** The dev hub simulator; only ever true together with devRoutes. */
  devHubSimulator: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  logLevel: string;
  kratosPublicUrl: string;
  kratosWebhookSecret: string | null;
  /** The boards' MQTT broker, or null when MQTT_URL is not set. */
  broker: { url: string; username: string; password: string } | null;
};

export class ConfigError extends Error {}

/** Validates the environment. Throws ConfigError naming every invalid variable, never their values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
    throw new ConfigError(`Invalid API configuration:\n${problems.join("\n")}`);
  }
  const value = parsed.data;
  if (value.MQTT_URL && !(value.MQTT_USERNAME && value.MQTT_PASSWORD)) {
    throw new ConfigError("Invalid API configuration:\n  MQTT_USERNAME, MQTT_PASSWORD: are required with MQTT_URL");
  }
  return {
    nodeEnv: value.NODE_ENV,
    devRoutes: env.NODE_ENV === "development",
    devHubSimulator: env.NODE_ENV === "development" && value.M2SMART_DEV_HUB_SIMULATOR === "true",
    host: value.API_HOST,
    port: value.API_PORT,
    databaseUrl: value.DATABASE_URL,
    databasePoolMax: value.DATABASE_POOL_MAX,
    logLevel: value.LOG_LEVEL,
    kratosPublicUrl: value.KRATOS_PUBLIC_URL.replace(/\/+$/, ""),
    kratosWebhookSecret: value.KRATOS_WEBHOOK_SECRET ?? null,
    broker: value.MQTT_URL ? { url: value.MQTT_URL, username: value.MQTT_USERNAME!, password: value.MQTT_PASSWORD! } : null,
  };
}
