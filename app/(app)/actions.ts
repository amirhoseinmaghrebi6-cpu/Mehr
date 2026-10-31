"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export async function signOutAction(): Promise<void> {
  await auth.signOut();
  redirect("/login?notice=signed-out");
}

/** Changing the phone number needs a recent sign-in: sign out, then come back to Settings. */
export async function reauthForPhoneAction(formData: FormData): Promise<void> {
  const back = String(formData.get("next") ?? "");
  const next = /^\/homes\/[^/?#]+\/settings$/.test(back) ? back : "/dashboard";
  await auth.signOut();
  redirect(`/login?notice=reauth-phone&next=${encodeURIComponent(next)}`);
}
