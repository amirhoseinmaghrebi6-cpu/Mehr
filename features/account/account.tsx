"use client";

/**
 * Settings → the account's mobile number, and changing it: a code goes to the new number, and
 * with it the account moves there (sign-in by code and by password). The API asks for a sign-in in
 * the last 15 minutes ("reauth"); then the user signs in again and comes back here.
 * In the demo no SMS is sent and the code is shown on screen.
 */
import { useEffect, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { LogIn, MessageSquareText, Smartphone } from "lucide-react";
import { normalizePhone } from "@m2smart/contracts";
import { reauthForPhoneAction } from "@/app/(app)/actions";
import { useI18n } from "@/components/i18n-provider";
import { phoneLabel } from "@/features/members/members";
import { gatewayMessage } from "@/lib/gateway-messages";
import { GatewayError, type GatewayErrorCode, type HomeGateway } from "@/services/home-gateway";
import { DEMO_PHONE_CODE } from "@/services/demo-gateway";

type Step = { kind: "idle" } | { kind: "number" } | { kind: "code"; phone: string };
const codeOf = (error: unknown): GatewayErrorCode => (error instanceof GatewayError ? error.code : "network");

export function AccountSection({ gateway, demo, onToast }: { gateway: HomeGateway; demo: boolean; onToast: (message: string) => void }) {
  const { locale, m } = useI18n();
  const t = m.account;
  const pathname = usePathname();
  const [phone, setPhone] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [input, setInput] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GatewayErrorCode | "invalid-phone" | null>(null);

  useEffect(() => {
    gateway.getPhone().then(setPhone, () => setPhone(""));
  }, [gateway]);

  const errorText = (stage: "number" | "code", code: typeof error) => {
    if (!code || code === "reauth") return null;
    if (code === "invalid-phone" || (stage === "number" && code === "invalid_request")) return t.invalidPhone;
    if (stage === "number" && code === "conflict") return t.taken;
    if (stage === "code" && code === "invalid_request") return t.wrongCode;
    if (stage === "code" && code === "not_found") return t.expired;
    if (stage === "code" && code === "conflict") return t.taken;
    return gatewayMessage(code, locale);
  };

  const sendCode = async (event?: FormEvent) => {
    event?.preventDefault();
    const target = step.kind === "code" ? step.phone : normalizePhone(input);
    if (!target) return setError("invalid-phone");
    setBusy(true);
    try {
      setStep({ kind: "code", phone: await gateway.changePhone(target) });
      setCode("");
      setError(null);
    } catch (caught) {
      setError(codeOf(caught));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const changed = await gateway.confirmPhone(code);
      setPhone(changed);
      setStep({ kind: "idle" });
      setInput("");
      setError(null);
      onToast(t.changed(phoneLabel(changed, locale)));
    } catch (caught) {
      setError(codeOf(caught));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setStep({ kind: "idle" });
    setError(null);
  };

  return (
    <div className="surface-panel settings-preferences account-panel">
      <div className="panel-intro"><span className="panel-overline">{t.overline}</span><h2>{t.title}</h2><p>{t.text}</p></div>
      <div className="account-phone">
        <span className="account-phone-icon" aria-hidden="true"><Smartphone size={18} /></span>
        <strong><bdi dir="ltr">{phone ? phoneLabel(phone, locale) : "…"}</bdi></strong>
        {step.kind === "idle" && <button type="button" className="button-subtle" onClick={() => setStep({ kind: "number" })}>{t.change}</button>}
      </div>

      {step.kind === "number" && (
        <form className="account-form" onSubmit={(event) => void sendCode(event)}>
          <label className="form-field"><span>{t.newNumber}</span><input type="tel" inputMode="tel" dir="ltr" autoComplete="tel" required maxLength={32} value={input} onChange={(event) => setInput(event.target.value)} placeholder={m.members.phonePlaceholder} autoFocus /></label>
          <div className="account-actions">
            <button type="submit" className="button-primary" disabled={busy}><MessageSquareText size={15} />{t.send}</button>
            <button type="button" className="button-subtle" onClick={cancel}>{m.common.cancel}</button>
          </div>
          {errorText("number", error) && <p className="account-error" role="alert">{errorText("number", error)}</p>}
        </form>
      )}

      {step.kind === "code" && (
        <form className="account-form" onSubmit={(event) => void confirm(event)}>
          <p className="form-note">{t.sentTo(phoneLabel(step.phone, locale))}</p>
          {demo && <p className="account-demo-code">{t.demoCode(DEMO_PHONE_CODE)}</p>}
          <label className="form-field"><span>{t.code}</span><input name="code" inputMode="numeric" dir="ltr" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} autoFocus /></label>
          <div className="account-actions">
            <button type="submit" className="button-primary" disabled={busy || code.length !== 6}>{t.confirm}</button>
            <button type="button" className="button-subtle" disabled={busy} onClick={() => void sendCode()}>{t.resend}</button>
            <button type="button" className="button-subtle" onClick={cancel}>{m.common.cancel}</button>
          </div>
          {errorText("code", error) && <p className="account-error" role="alert">{errorText("code", error)}</p>}
        </form>
      )}

      {error === "reauth" && (
        <form className="account-reauth" action={reauthForPhoneAction} role="alert">
          <p>{t.reauthText}</p>
          <input type="hidden" name="next" value={pathname} />
          <button type="submit" className="button-primary"><LogIn size={15} />{t.reauthButton}</button>
        </form>
      )}
    </div>
  );
}
