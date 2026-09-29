"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?error=credentials");

  const result = await auth.submitLogin({ identifier: email, password });
  if (!result.ok) redirect(`/login?error=${result.error}`);
  redirect(safeNext(formData.get("next")));
}

export async function signUpAction(formData: FormData): Promise<void> {
  if (!(await auth.startRegistration()).available) redirect("/register?error=setup");

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (!fullName || !email) redirect("/register?error=required");
  if (password.length < 12) redirect("/register?error=weak-password");
  if (password !== confirmPassword) redirect("/register?error=password-mismatch");

  const result = await auth.submitRegistration({ fullName, email, password });
  if (!result.ok) redirect(`/register?error=${result.error}`);
  if (result.status === "signed_in") redirect("/dashboard");
  redirect(`/login?notice=verify-email&email=${encodeURIComponent(email)}`);
}

export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  if (!(await auth.startRecovery()).available) redirect("/forgot-password?error=setup");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/forgot-password?error=required");

  await auth.submitRecovery({ step: "request", email });
  // Always use the same response to avoid revealing whether an account exists.
  redirect("/forgot-password?notice=reset-requested");
}

export async function updatePasswordAction(formData: FormData): Promise<void> {
  if (!(await auth.startRecovery()).available) redirect("/update-password?error=setup");

  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (password.length < 12) redirect("/update-password?error=weak-password");
  if (password !== confirmPassword) redirect("/update-password?error=password-mismatch");

  const result = await auth.submitRecovery({ step: "set_password", password });
  if (!result.ok) redirect(result.error === "reset-session" ? "/login?error=reset-session" : `/update-password?error=${result.error}`);
  redirect("/dashboard");
}
