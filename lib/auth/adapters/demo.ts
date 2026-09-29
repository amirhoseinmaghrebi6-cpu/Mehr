/**
 * Demo adapter: the isolated, sample-data demo account. Must always keep working, in every
 * environment where it is enabled (see isDemoAuthEnabled for the production guard).
 */
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { DemoCredentials, Principal } from "@/lib/auth/types";
import {
  createDemoSessionToken,
  DEMO_COOKIE_NAME,
  DEMO_SESSION_MAX_AGE,
  getDemoCredentials,
  isDemoAuthEnabled,
  verifyDemoCredentials,
  verifyDemoSessionToken,
} from "@/lib/auth/adapters/demo-session";

export const demoAdapter = {
  isEnabled: isDemoAuthEnabled,

  /** Credentials to show on the login screen, only while demo access is enabled. */
  credentials(): DemoCredentials | null {
    return isDemoAuthEnabled() ? getDemoCredentials() : null;
  },

  /** Whether this login attempt is for the demo account (so the password is checked here). */
  isDemoIdentifier(identifier: string): boolean {
    const credentials = getDemoCredentials();
    return isDemoAuthEnabled() && credentials !== null && identifier === credentials.username.trim().toLowerCase();
  },

  verifyCredentials: verifyDemoCredentials,

  async startSession(): Promise<void> {
    const { token } = await createDemoSessionToken();
    const cookieStore = await cookies();
    cookieStore.set(DEMO_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEMO_SESSION_MAX_AGE,
    });
  },

  async endSession(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(DEMO_COOKIE_NAME);
  },

  async getCurrentPrincipal(): Promise<Principal | null> {
    if (!isDemoAuthEnabled()) return null;
    const cookieStore = await cookies();
    const session = await verifyDemoSessionToken(cookieStore.get(DEMO_COOKIE_NAME)?.value);
    if (!session) return null;
    return { userId: session.userId, sessionId: null, displayName: "M2smart Demo", authMethod: "demo", issuer: "cloud" };
  },

  /** Middleware variant: reads the cookie from the incoming request. */
  async hasRequestSession(request: NextRequest): Promise<boolean> {
    if (!isDemoAuthEnabled()) return false;
    return (await verifyDemoSessionToken(request.cookies.get(DEMO_COOKIE_NAME)?.value)) !== null;
  },
};
