/**
 * The app's AuthGateway. Combines the demo account with the configured provider (Supabase
 * during development; Kratos from Phase 2D/2E):
 *
 * - The demo account is recognised by its username and always handled by the demo adapter.
 * - Everything else goes to the provider; journeys it cannot serve report `available: false`.
 *
 * App code imports only from "@/lib/auth"; adapters are private (enforced by ESLint).
 */
import { NextResponse, type NextRequest } from "next/server";
import type { AuthGateway } from "@/lib/auth/gateway";
import { demoAdapter } from "@/lib/auth/adapters/demo";
import { supabaseAdapter } from "@/lib/auth/adapters/supabase";

export type { AuthGateway } from "@/lib/auth/gateway";
export type * from "@/lib/auth/types";

export const auth: AuthGateway = {
  async getCurrentPrincipal() {
    return (await demoAdapter.getCurrentPrincipal()) ?? (await supabaseAdapter.getCurrentPrincipal());
  },

  async startLogin() {
    const demoCredentials = demoAdapter.credentials();
    return { available: supabaseAdapter.isConfigured() || demoCredentials !== null, demoCredentials };
  },

  async submitLogin({ identifier, password }) {
    if (demoAdapter.isDemoIdentifier(identifier)) {
      if (!demoAdapter.verifyCredentials(identifier, password)) return { ok: false, error: "demo-credentials" };
      if (supabaseAdapter.isConfigured()) await supabaseAdapter.signOut();
      await demoAdapter.startSession();
      return { ok: true };
    }

    if (!supabaseAdapter.isConfigured()) return { ok: false, error: "setup" };
    await demoAdapter.endSession();
    return supabaseAdapter.signInWithPassword(identifier, password);
  },

  async startRegistration() {
    return { available: supabaseAdapter.isConfigured() };
  },

  async submitRegistration(input) {
    if (!supabaseAdapter.isConfigured()) return { ok: false, error: "setup" };
    return supabaseAdapter.signUp(input);
  },

  async startRecovery() {
    return { available: supabaseAdapter.isConfigured() };
  },

  async submitRecovery(input) {
    if (!supabaseAdapter.isConfigured()) return { ok: false, error: "setup" };
    if (input.step === "request") {
      // Same outcome whether or not the account exists, so the response reveals nothing.
      await supabaseAdapter.requestPasswordReset(input.email);
      return { ok: true };
    }
    return supabaseAdapter.setPassword(input.password);
  },

  async completeEmailLink(code) {
    if (!supabaseAdapter.isConfigured()) return { ok: false, error: "verification" };
    return supabaseAdapter.exchangeEmailLinkCode(code);
  },

  async signOut() {
    await demoAdapter.endSession();
    if (supabaseAdapter.isConfigured()) await supabaseAdapter.signOut();
  },
};

export type RequestSession = {
  signedIn: boolean;
  /** Whether a real (non-demo) provider is configured. */
  providerConfigured: boolean;
  demoEnabled: boolean;
  /** Pass-through response; carries refreshed provider cookies when there are any. */
  response: NextResponse;
};

/** Session check for middleware, which reads cookies from the request instead of next/headers. */
export async function resolveRequestSession(request: NextRequest): Promise<RequestSession> {
  const demoSignedIn = await demoAdapter.hasRequestSession(request);
  const demoEnabled = demoAdapter.isEnabled();

  if (!supabaseAdapter.isConfigured()) {
    return { signedIn: demoSignedIn, providerConfigured: false, demoEnabled, response: NextResponse.next({ request }) };
  }
  const provider = await supabaseAdapter.resolveRequestSession(request);
  return { signedIn: demoSignedIn || provider.signedIn, providerConfigured: true, demoEnabled, response: provider.response };
}
