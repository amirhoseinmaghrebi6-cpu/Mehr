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

/** Error body for 401 (no or invalid session) and 503 (auth service unavailable). */
export interface ApiErrorResponse {
  error: "unauthenticated" | "auth_unavailable" | "forbidden" | "invalid_request" | "conflict";
}
