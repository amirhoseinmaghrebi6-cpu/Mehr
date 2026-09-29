/**
 * The app's AuthGateway. Combines the demo account with self-hosted Ory Kratos (SMS code +
 * optional password, decision D1). Kratos is used when KRATOS_PUBLIC_URL and
 * M2SMART_API_INTERNAL_URL are set; without them only the demo account (if enabled) works.
 *
 * The demo account is recognised by its username and always handled by the demo adapter.
 * App code imports only from "@/lib/auth"; adapters are private (enforced by ESLint).
 */
import { NextResponse, type NextRequest } from "next/server";
import type { AuthGateway } from "@/lib/auth/gateway";
import type { Failure, LoginMethod } from "@/lib/auth/types";
import { demoAdapter } from "@/lib/auth/adapters/demo";
import { kratosAdapter, KratosUnavailableError } from "@/lib/auth/adapters/kratos";

export type { AuthGateway } from "@/lib/auth/gateway";
export type * from "@/lib/auth/types";
export { maskPhone, normalizePhone } from "@/lib/auth/phone";

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
    return kratosAdapter.isConfigured() ? kratosAdapter.getCurrentPrincipal() : null;
  },

  async startLogin() {
    const demoCredentials = demoAdapter.credentials();
    const methods: LoginMethod[] = kratosAdapter.isConfigured() ? ["sms_code", "password"] : [];
    return { available: methods.length > 0 || demoCredentials !== null, methods, demoCredentials };
  },

  async submitLogin(input) {
    if (input.method === "password" && demoAdapter.isDemoIdentifier(input.identifier)) {
      if (!demoAdapter.verifyCredentials(input.identifier, input.password)) return { ok: false, error: "demo-credentials" };
      if (kratosAdapter.isConfigured()) await guard(() => kratosAdapter.signOut());
      await demoAdapter.startSession();
      return { ok: true, status: "signed_in" };
    }

    if (!kratosAdapter.isConfigured()) return setup;
    await demoAdapter.endSession();
    return guard(() => {
      if (input.method === "password") return kratosAdapter.signInWithPassword(input.identifier, input.password);
      return input.step === "send" ? kratosAdapter.sendLoginCode(input.phone) : kratosAdapter.verifyLoginCode(input.flowId, input.code);
    });
  },

  async startRegistration() {
    return { available: kratosAdapter.isConfigured(), method: "sms_code" };
  },

  async submitRegistration(input) {
    if (!kratosAdapter.isConfigured()) return setup;
    await demoAdapter.endSession();
    return guard(() =>
      input.step === "send" ? kratosAdapter.sendRegistrationCode(input.fullName, input.phone) : kratosAdapter.verifyRegistrationCode(input.flowId, input.code),
    );
  },

  async startRecovery() {
    return { available: kratosAdapter.isConfigured(), method: "sms_code_login" };
  },

  async submitRecovery(input) {
    if (!kratosAdapter.isConfigured()) return setup;
    return guard(() => kratosAdapter.setPassword(input.password));
  },

  async signOut() {
    await demoAdapter.endSession();
    if (kratosAdapter.isConfigured()) await guard(() => kratosAdapter.signOut());
  },
};

export type RequestSession = {
  signedIn: boolean;
  /** Whether Kratos is configured (the demo account alone does not count). */
  providerConfigured: boolean;
  demoEnabled: boolean;
  /** Pass-through response for the middleware. */
  response: NextResponse;
};

/** Session check for middleware, which reads cookies from the request instead of next/headers. */
export async function resolveRequestSession(request: NextRequest): Promise<RequestSession> {
  const demoSignedIn = await demoAdapter.hasRequestSession(request);
  const providerConfigured = kratosAdapter.isConfigured();
  const signedIn = demoSignedIn || (providerConfigured && (await kratosAdapter.hasRequestSession(request)));
  return { signedIn, providerConfigured, demoEnabled: demoAdapter.isEnabled(), response: NextResponse.next({ request }) };
}
