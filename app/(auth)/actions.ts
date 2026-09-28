"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createDemoSessionToken, DEMO_COOKIE_NAME, DEMO_SESSION_MAX_AGE, getDemoCredentials, isDemoAuthEnabled, verifyDemoCredentials } from "@/lib/demo-auth";

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?error=credentials");

  const demoCredentials = getDemoCredentials();
  if (isDemoAuthEnabled() && demoCredentials && email === demoCredentials.username.trim().toLowerCase()) {
    if (!verifyDemoCredentials(email, password)) redirect("/login?error=demo-credentials");

    if (isSupabaseConfigured()) {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    }

    const { token } = await createDemoSessionToken();
    const cookieStore = await cookies();
    cookieStore.set(DEMO_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEMO_SESSION_MAX_AGE,
    });
    redirect(safeRedirectPath(formData.get("next")));
  }

  if (!isSupabaseConfigured()) redirect("/login?error=setup");
  const cookieStore = await cookies();
  cookieStore.delete(DEMO_COOKIE_NAME);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=credentials");

  redirect(safeRedirectPath(formData.get("next")));
}

export async function signUpAction(formData: FormData): Promise<void> {
  if (!isSupabaseConfigured()) redirect("/register?error=setup");

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (!fullName || !email) redirect("/register?error=required");
  if (password.length < 12) redirect("/register?error=weak-password");
  if (password !== confirmPassword) redirect("/register?error=password-mismatch");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/dashboard`,
    },
  });

  if (error) redirect("/register?error=signup-failed");
  if (data.session) redirect("/dashboard");
  redirect(`/login?notice=verify-email&email=${encodeURIComponent(email)}`);
}

export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  if (!isSupabaseConfigured()) redirect("/forgot-password?error=setup");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/forgot-password?error=required");

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl()}/auth/callback?next=/update-password`,
  });

  // Always use the same response to avoid revealing whether an account exists.
  redirect("/forgot-password?notice=reset-requested");
}

export async function updatePasswordAction(formData: FormData): Promise<void> {
  if (!isSupabaseConfigured()) redirect("/update-password?error=setup");

  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (password.length < 12) redirect("/update-password?error=weak-password");
  if (password !== confirmPassword) redirect("/update-password?error=password-mismatch");

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=reset-session");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/update-password?error=update-failed");
  redirect("/dashboard");
}
