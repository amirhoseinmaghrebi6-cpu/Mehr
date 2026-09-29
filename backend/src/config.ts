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
});

export type Config = {
  nodeEnv: "development" | "test" | "production";
  /**
   * Development-only routes (e.g. POST /internal/dev/sms). True only when NODE_ENV is set to
   * "development" explicitly; the NODE_ENV default does not count, so a forgotten variable in
   * production never opens them.
   */
  devRoutes: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  logLevel: string;
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
  return {
    nodeEnv: value.NODE_ENV,
    devRoutes: env.NODE_ENV === "development",
    host: value.API_HOST,
    port: value.API_PORT,
    databaseUrl: value.DATABASE_URL,
    databasePoolMax: value.DATABASE_POOL_MAX,
    logLevel: value.LOG_LEVEL,
  };
}
