"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { latinDigits } from "@/lib/auth/phone";

export async function signOutAction(): Promise<void> {
  await auth.signOut();
  redirect("/login?notice=signed-out");
}

/** The admin panel's second step: links an authenticator app with its first code. */
export async function linkTwoFactorAction(formData: FormData): Promise<void> {
  const code = latinDigits(String(formData.get("code") ?? "")).replace(/\s/g, "");
  const flowId = String(formData.get("flow") ?? "");
  if (!/^\d{6}$/.test(code)) redirect("/admin?error=code-invalid");
  const result = await auth.submitTwoFactor({ step: "link", flowId, code });
  if (!result.ok && result.error === "reauth-required") {
    // Linking needs a recent sign-in: sign out, sign in again, come back here.
    await auth.signOut();
    redirect("/login?notice=reauth&next=%2Fadmin");
  }
  redirect(result.ok ? "/admin?linked=1" : `/admin?error=${result.error}`);
}

/** The admin panel's second step: a code from the linked authenticator app. */
export async function verifyTwoFactorAction(formData: FormData): Promise<void> {
  const code = latinDigits(String(formData.get("code") ?? "")).replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) redirect("/admin?error=code-invalid");
  const result = await auth.submitTwoFactor({ step: "verify", code });
  redirect(result.ok ? "/admin" : `/admin?error=${result.error}`);
}

/** Changing the phone number needs a recent sign-in: sign out, then come back to Settings. */
export async function reauthForPhoneAction(formData: FormData): Promise<void> {
  const back = String(formData.get("next") ?? "");
  const next = /^\/homes\/[^/?#]+\/settings$/.test(back) ? back : "/dashboard";
  await auth.signOut();
  redirect(`/login?notice=reauth-phone&next=${encodeURIComponent(next)}`);
}
