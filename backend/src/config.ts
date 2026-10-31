import { normalizePhone } from "@m2smart/contracts";
import { z } from "zod";

const unsetWhenEmpty = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

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
  // Kratos admin API, used only by the operator's panel to block and delete accounts. Never
  // reachable from outside (production: the compose network; development: 127.0.0.1).
  KRATOS_ADMIN_URL: unsetWhenEmpty(z.url({ protocol: /^https?$/, error: "must be an http(s) URL" })),
  // The operators: mobile numbers (comma-separated, any usual form) that see the admin panel.
  PLATFORM_ADMIN_PHONES: z.string().default(""),
  // Shared secret Kratos sends with the identity webhook. Without it the webhook route is off.
  KRATOS_WEBHOOK_SECRET: z.string().min(32, { error: "must be at least 32 characters" }).optional(),
  // The MQTT broker the ESP32 boards connect to, and the API's account on it. Without MQTT_URL the
  // API runs with no board connection (boards then never come online).
  MQTT_URL: z.url({ protocol: /^mqtts?$/, error: "must be an mqtt:// or mqtts:// URL" }).optional(),
  MQTT_USERNAME: z.string().min(1).optional(),
  MQTT_PASSWORD: z.string().min(16, { error: "must be at least 16 characters" }).optional(),
  // Development only: simulated ESP32 boards connect to the broker (src/dev/board-simulator.ts).
  M2SMART_DEV_BOARD_SIMULATOR: z.enum(["true", "false"]).default("false"),
  // Text messages through FarazSMS / IranPayamak. Without SMS_API_KEY, development only logs them
  // and production cannot send login codes. Pattern codes come from the provider once approved.
  SMS_API_URL: z.url({ protocol: /^https$/, error: "must be an https URL" }).default("https://api.iranpayamak.com"),
  // An empty line in the env file (`SMS_API_KEY=`) counts as not set.
  SMS_API_KEY: unsetWhenEmpty(z.string().min(8, { error: "is too short" })),
  SMS_SENDER: unsetWhenEmpty(z.string().regex(/^\d{4,15}$/, { error: "must be the sender line, e.g. 90008361" })),
  SMS_PATTERN_CODE: unsetWhenEmpty(z.string()),
  SMS_PATTERN_INVITATION: unsetWhenEmpty(z.string()),
});

export type Config = {
  nodeEnv: "development" | "test" | "production";
  /**
   * Development-only routes (e.g. POST /internal/dev/report). True only when NODE_ENV is set to
   * "development" explicitly; the NODE_ENV default does not count, so a forgotten variable in
   * production never opens them.
   */
  devRoutes: boolean;
  /** The dev board simulator; only ever true together with devRoutes. */
  devBoardSimulator: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  logLevel: string;
  kratosPublicUrl: string;
  kratosWebhookSecret: string | null;
  kratosAdminUrl: string | null;
  /** The operators' numbers in E.164 (PLATFORM_ADMIN_PHONES). */
  platformAdmins: string[];
  /** The SMS provider, or null until SMS_API_KEY, SMS_SENDER and SMS_PATTERN_CODE are all set. */
  sms: { url: string; apiKey: string; sender: string; patterns: { code: string; invitation: string | null } } | null;
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
  const adminEntries = value.PLATFORM_ADMIN_PHONES.split(",").map((entry) => entry.trim()).filter(Boolean);
  const platformAdmins = adminEntries.map(normalizePhone);
  if (platformAdmins.includes(null)) {
    throw new ConfigError("Invalid API configuration:\n  PLATFORM_ADMIN_PHONES: must be mobile numbers separated by commas");
  }
  // The key alone is not enough to send: until the sender and the approved code pattern are set too,
  // there is no provider (the server warns at startup).
  const smsReady = Boolean(value.SMS_API_KEY && value.SMS_SENDER && value.SMS_PATTERN_CODE);
  return {
    nodeEnv: value.NODE_ENV,
    devRoutes: env.NODE_ENV === "development",
    devBoardSimulator: env.NODE_ENV === "development" && value.M2SMART_DEV_BOARD_SIMULATOR === "true",
    host: value.API_HOST,
    port: value.API_PORT,
    databaseUrl: value.DATABASE_URL,
    databasePoolMax: value.DATABASE_POOL_MAX,
    logLevel: value.LOG_LEVEL,
    kratosPublicUrl: value.KRATOS_PUBLIC_URL.replace(/\/+$/, ""),
    kratosWebhookSecret: value.KRATOS_WEBHOOK_SECRET ?? null,
    kratosAdminUrl: value.KRATOS_ADMIN_URL?.replace(/\/+$/, "") ?? null,
    platformAdmins: platformAdmins as string[],
    sms: smsReady
      ? {
          url: value.SMS_API_URL.replace(/\/+$/, ""),
          apiKey: value.SMS_API_KEY!,
          sender: value.SMS_SENDER!,
          patterns: { code: value.SMS_PATTERN_CODE!, invitation: value.SMS_PATTERN_INVITATION ?? null },
        }
      : null,
    broker: value.MQTT_URL ? { url: value.MQTT_URL, username: value.MQTT_USERNAME!, password: value.MQTT_PASSWORD! } : null,
  };
}
