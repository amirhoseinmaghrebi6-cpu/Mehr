export type OrganizationRole = "owner" | "admin" | "member";

/** GET /v1/me — the signed-in user, their profile and the organizations they belong to. */
export interface MeResponse {
  user: {
    id: string;
    displayName: string;
    phone: string | null;
    email: string | null;
  };
  organizations: Array<{
    id: string;
    name: string;
    role: OrganizationRole;
  }>;
  session: {
    /** How the user signed in for this session, e.g. "code" (SMS) or "password". */
    authMethods: string[];
    expiresAt: string;
  };
}

/**
 * Error body for every error response: 401 (no or invalid session), 403, 404 (also for homes the
 * user may not see, so their existence is never revealed), 400, 409 and 503 (auth unavailable).
 */
export interface ApiErrorResponse {
  error: "unauthenticated" | "auth_unavailable" | "forbidden" | "not_found" | "invalid_request" | "conflict";
}
