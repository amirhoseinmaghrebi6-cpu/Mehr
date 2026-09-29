"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { latinDigits } from "@/lib/auth/phone";

function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** Builds a same-site path with query parameters; never an absolute URL. */
function to(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** Password sign-in: mobile number + password, or the demo account. */
export async function signInAction(formData: FormData): Promise<void> {
  const identifier = field(formData, "identifier").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  if (!identifier || !password) redirect(to("/login", { error: "credentials", mode: "password", next }));

  const result = await auth.submitLogin({ method: "password", identifier, password });
  if (!result.ok) redirect(to("/login", { error: result.error, mode: "password", next }));
  redirect(next);
}

/** SMS sign-in, step 1: send a code to the mobile number. */
export async function sendLoginCodeAction(formData: FormData): Promise<void> {
  const phone = field(formData, "phone");
  const next = safeNext(formData.get("next"));
  if (!phone) redirect(to("/login", { error: "phone-invalid", next }));

  const result = await auth.submitLogin({ method: "sms_code", step: "send", phone });
  if (!result.ok) redirect(to("/login", { error: result.error, phone, next }));
  if (result.status !== "code_sent") redirect(next);
  redirect(to("/login", { flow: result.flowId, phone: result.phone, next }));
}

/** SMS sign-in, step 2: check the code. */
export async function verifyLoginCodeAction(formData: FormData): Promise<void> {
  const flowId = field(formData, "flow");
  const phone = field(formData, "phone");
  const code = latinDigits(field(formData, "code")).replace(/\s/g, "");
  const next = safeNext(formData.get("next"));
  if (!/^\d{6}$/.test(code)) redirect(to("/login", { error: "code-invalid", flow: flowId, phone, next }));

  const result = await auth.submitLogin({ method: "sms_code", step: "verify", flowId, code });
  if (!result.ok) {
    // Only a wrong code keeps the same flow; anything else starts over from the number.
    const keepFlow = result.error === "code-invalid";
    redirect(to("/login", { error: result.error, flow: keepFlow ? flowId : undefined, phone, next }));
  }
  redirect(next);
}

/** SMS registration, step 1: name and mobile number, then a code by SMS. */
export async function sendRegistrationCodeAction(formData: FormData): Promise<void> {
  const fullName = field(formData, "fullName");
  const phone = field(formData, "phone");
  if (!fullName || fullName.length > 80 || !phone) redirect(to("/register", { error: "required", phone }));

  const result = await auth.submitRegistration({ method: "sms_code", step: "send", fullName, phone });
  if (!result.ok) redirect(to("/register", { error: result.error, phone }));
  if (result.status !== "code_sent") redirect("/dashboard");
  redirect(to("/register", { flow: result.flowId, phone: result.phone }));
}

/** SMS registration, step 2: check the code; the account is created and signed in. */
export async function verifyRegistrationCodeAction(formData: FormData): Promise<void> {
  const flowId = field(formData, "flow");
  const phone = field(formData, "phone");
  const code = latinDigits(field(formData, "code")).replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) redirect(to("/register", { error: "code-invalid", flow: flowId, phone }));

  const result = await auth.submitRegistration({ method: "sms_code", step: "verify", flowId, code });
  if (!result.ok) {
    if (result.error === "phone-taken") redirect(to("/login", { error: "phone-taken", phone }));
    redirect(to("/register", { error: result.error, flow: result.error === "code-invalid" ? flowId : undefined, phone }));
  }
  redirect("/dashboard");
}

export async function updatePasswordAction(formData: FormData): Promise<void> {
  if (!(await auth.startRecovery()).available) redirect("/update-password?error=setup");

  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (password.length < 12) redirect("/update-password?error=weak-password");
  if (password !== confirmPassword) redirect("/update-password?error=password-mismatch");

  const result = await auth.submitRecovery({ step: "set_password", password });
  if (!result.ok) {
    if (result.error === "reauth-required") {
      // Setting a password needs a fresh sign-in: sign out, then come back here after the code.
      await auth.signOut();
      redirect("/login?notice=reauth&next=/update-password");
    }
    redirect(`/update-password?error=${result.error}`);
  }
  redirect("/dashboard");
}
