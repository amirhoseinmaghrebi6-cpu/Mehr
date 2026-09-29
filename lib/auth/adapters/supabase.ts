/**
 * Supabase adapter: email + password accounts in Supabase Auth. Development only; production
 * auth moves to self-hosted Kratos (Phase 2D/2E) and this adapter is removed in Phase 2G.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailLinkResult, LoginResult, Principal, RecoveryResult, RegistrationInput, RegistrationResult } from "@/lib/auth/types";
import { createSupabaseServerClient, getSupabasePublicKey, isSupabaseConfigured } from "@/lib/auth/adapters/supabase-client";

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export const supabaseAdapter = {
  /** Used only when M2SMART_AUTH_PROVIDER=supabase (development). */
  isConfigured(): boolean {
    return process.env.M2SMART_AUTH_PROVIDER === "supabase" && isSupabaseConfigured();
  },

  async getCurrentPrincipal(): Promise<Principal | null> {
    if (!isSupabaseConfigured()) return null;
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;

    const displayName = typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : user.email?.split("@")[0] ?? "M2smart member";
    return { userId: user.id, sessionId: null, displayName, authMethod: "password", issuer: "cloud" };
  },

  async signInWithPassword(email: string, password: string): Promise<LoginResult> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { ok: false, error: "credentials" } : { ok: true, status: "signed_in" };
  },

  async signUp({ fullName, email, password }: Extract<RegistrationInput, { method: "email_password" }>): Promise<RegistrationResult> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${siteUrl()}/auth/callback?next=/dashboard`,
      },
    });
    if (error) return { ok: false, error: "signup-failed" };
    return data.session ? { ok: true, status: "signed_in" } : { ok: true, status: "verification_sent" };
  },

  async requestPasswordReset(email: string): Promise<void> {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl()}/auth/callback?next=/update-password`,
    });
  },

  /** Sets a new password for the user signed in through a recovery link. */
  async setPassword(password: string): Promise<RecoveryResult> {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "reset-session" };

    const { error } = await supabase.auth.updateUser({ password });
    return error ? { ok: false, error: "update-failed" } : { ok: true };
  },

  async exchangeEmailLinkCode(code: string): Promise<EmailLinkResult> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? { ok: false, error: "verification" } : { ok: true };
  },

  async signOut(): Promise<void> {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  },

  /**
   * Middleware variant: checks the session on the incoming request and returns the pass-through
   * response carrying any refreshed Supabase auth cookies.
   */
  async resolveRequestSession(request: NextRequest): Promise<{ signedIn: boolean; response: NextResponse }> {
    let response = NextResponse.next({ request });
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabasePublicKey()!, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();
    return { signedIn: Boolean(user), response };
  },
};
