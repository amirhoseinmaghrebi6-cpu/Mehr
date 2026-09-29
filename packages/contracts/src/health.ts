export type HealthStatus = "ok" | "unavailable";

/**
 * GET /healthz — the process is up (liveness); never touches dependencies.
 * GET /readyz  — the process can serve traffic; `checks` lists each dependency.
 */
export interface HealthResponse {
  status: HealthStatus;
  checks?: {
    database: HealthStatus;
  };
}
