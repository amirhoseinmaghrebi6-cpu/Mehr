/**
 * The app's AuthGateway. Combines the demo account with one real provider, chosen by
 * M2SMART_AUTH_PROVIDER:
 *
 * - "kratos" (default): self-hosted Ory Kratos, SMS code + optional password (Phase 2E).
 * - "supabase": Supabase Auth, email + password; development only, removed in Phase 2G.
 *
 * The demo account is recognised by its username and always handled by the demo adapter.
 * App code imports only from "@/lib/auth"; adapters are private (enforced by ESLint).
 */
import { NextResponse, type NextRequest } from "next/server";
import type { AuthGateway } from "@/lib/auth/gateway";
import type { Failure, LoginMethod } from "@/lib/auth/types";
import { demoAdapter } from "@/lib/auth/adapters/demo";
import { kratosAdapter, KratosUnavailableError } from "@/lib/auth/adapters/kratos";
import { supabaseAdapter } from "@/lib/auth/adapters/supabase";

export type { AuthGateway } from "@/lib/auth/gateway";
export type * from "@/lib/auth/types";
export { maskPhone, normalizePhone } from "@/lib/auth/phone";

type Provider = "kratos" | "supabase" | "none";

function provider(): Provider {
  if (supabaseAdapter.isConfigured()) return "supabase";
  if (kratosAdapter.isConfigured()) return "kratos";
  return "none";
}

const setup: Failure = { ok: false, error: "setup" };

/** Kratos or the API being down is shown as "try again shortly", never as bad credentials. */
async function guard<T>(work: () => Promise<T>): Promise<T | Failure> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof KratosUnavailableError) return { ok: false, error: "unavailable" };
    throw error;
  }
}

export const auth: AuthGateway = {
  async getCurrentPrincipal() {
    const demo = await demoAdapter.getCurrentPrincipal();
    if (demo) return demo;
    switch (provider()) {
      case "kratos":
        return kratosAdapter.getCurrentPrincipal();
      case "supabase":
        return supabaseAdapter.getCurrentPrincipal();
      default:
        return null;
    }
  },

  async startLogin() {
    const demoCredentials = demoAdapter.credentials();
    const methods: LoginMethod[] = { kratos: ["sms_code", "password"] as LoginMethod[], supabase: ["email_password"] as LoginMethod[], none: [] }[provider()];
    return { available: methods.length > 0 || demoCredentials !== null, methods, demoCredentials };
  },

  async submitLogin(input) {
    if (input.method !== "sms_code" && demoAdapter.isDemoIdentifier(input.identifier)) {
      if (!demoAdapter.verifyCredentials(input.identifier, input.password)) return { ok: false, error: "demo-credentials" };
      if (provider() === "supabase") await supabaseAdapter.signOut();
      if (provider() === "kratos") await guard(() => kratosAdapter.signOut());
      await demoAdapter.startSession();
      return { ok: true, status: "signed_in" };
    }

    const current = provider();
    if (current === "none") return setup;
    await demoAdapter.endSession();

    if (current === "supabase") {
      return input.method === "sms_code" ? setup : supabaseAdapter.signInWithPassword(input.identifier, input.password);
    }
    return guard(() => {
      if (input.method !== "sms_code") return kratosAdapter.signInWithPassword(input.identifier, input.password);
      return input.step === "send" ? kratosAdapter.sendLoginCode(input.phone) : kratosAdapter.verifyLoginCode(input.flowId, input.code);
    });
  },

  async startRegistration() {
    const current = provider();
    return { available: current !== "none", method: current === "supabase" ? "email_password" : "sms_code" };
  },

  async submitRegistration(input) {
    const current = provider();
    if (current === "supabase" && input.method === "email_password") return supabaseAdapter.signUp(input);
    if (current !== "kratos" || input.method !== "sms_code") return setup;
    await demoAdapter.endSession();
    return guard(() =>
      input.step === "send" ? kratosAdapter.sendRegistrationCode(input.fullName, input.phone) : kratosAdapter.verifyRegistrationCode(input.flowId, input.code),
    );
  },

  async startRecovery() {
    const current = provider();
    return { available: current !== "none", method: current === "supabase" ? "email_link" : "sms_code_login" };
  },

  async submitRecovery(input) {
    const current = provider();
    if (current === "none") return setup;
    if (input.step === "request") {
      if (current !== "supabase") return setup;
      // Same outcome whether or not the account exists, so the response reveals nothing.
      await supabaseAdapter.requestPasswordReset(input.email);
      return { ok: true };
    }
    return current === "supabase" ? supabaseAdapter.setPassword(input.password) : guard(() => kratosAdapter.setPassword(input.password));
  },

  async completeEmailLink(code) {
    if (provider() !== "supabase") return { ok: false, error: "verification" };
    return supabaseAdapter.exchangeEmailLinkCode(code);
  },

  async signOut() {
    await demoAdapter.endSession();
    const current = provider();
    if (current === "supabase") await supabaseAdapter.signOut();
    if (current === "kratos") await guard(() => kratosAdapter.signOut());
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

  switch (provider()) {
    case "supabase": {
      const session = await supabaseAdapter.resolveRequestSession(request);
      return { signedIn: demoSignedIn || session.signedIn, providerConfigured: true, demoEnabled, response: session.response };
    }
    case "kratos": {
      const signedIn = demoSignedIn || (await kratosAdapter.hasRequestSession(request));
      return { signedIn, providerConfigured: true, demoEnabled, response: NextResponse.next({ request }) };
    }
    default:
      return { signedIn: demoSignedIn, providerConfigured: false, demoEnabled, response: NextResponse.next({ request }) };
  }
}
