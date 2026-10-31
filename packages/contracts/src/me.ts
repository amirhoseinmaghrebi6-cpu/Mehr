import type { UserSettings } from "./settings.js";

export type OrganizationRole = "owner" | "admin" | "member";

/** GET /v1/me — the signed-in user, their profile and the organizations they belong to. */
export interface MeResponse {
  user: {
    id: string;
    displayName: string;
    phone: string | null;
    email: string | null;
    /** One of the operators (PLATFORM_ADMIN_PHONES): the app shows the admin panel. */
    platformAdmin: boolean;
  };
  organizations: Array<{
    id: string;
    name: string;
    role: OrganizationRole;
  }>;
  /** Display preferences (also GET/PATCH /v1/me/settings). */
  settings: UserSettings;
  session: {
    /** How the user signed in for this session, e.g. "code" (SMS) or "password". */
    authMethods: string[];
    expiresAt: string;
  };
}

/**
 * Error body for every error response: 401 (no or invalid session), 403, 404 (also for homes the
 * user may not see, so their existence is never revealed), 400, 409, 500 (never with details) and
 * 503 (auth unavailable). Changing the phone number may also answer 403 reauth_required (sign in
 * again first) and 429 rate_limited.
 */
export interface ApiErrorResponse {
  error: "unauthenticated" | "auth_unavailable" | "forbidden" | "not_found" | "invalid_request" | "conflict" | "internal_error" | "reauth_required" | "rate_limited";
}
