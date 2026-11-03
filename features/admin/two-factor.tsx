"use client";

/**
 * The admin panel's second sign-in step. An operator's phone number alone (a stolen SIM) must not
 * open every account and the firmware of every board, so the panel also needs a code from an
 * authenticator app (Google Authenticator, Microsoft Authenticator, FreeOTP …; TOTP, set up through
 * Kratos). The first time, the operator scans a QR code and types the app's first code; after that,
 * one code per sign-in. The API checks the same on every /v1/admin request.
 *
 * The demo plays the step in the browser: any six digits open the sample panel.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { linkTwoFactorAction, verifyTwoFactorAction } from "@/app/(app)/actions";
import { useI18n } from "@/components/i18n-provider";
import type { TwoFactorFlow } from "@/lib/auth";

function CodeField() {
  const t = useI18n().m.admin.twoFactor;
  return (
    <label className="form-field">
      <span>{t.codeLabel}</span>
      <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9۰-۹٠-٩ ]{6,7}" maxLength={7} required dir="ltr" className="two-factor-code" autoFocus />
    </label>
  );
}

export function TwoFactorGate({ flow, error, linked }: { flow: TwoFactorFlow; error?: string; linked: boolean }) {
  const { m } = useI18n();
  const t = m.admin.twoFactor;
  const errorText = error ? (t.errors[error as keyof typeof t.errors] ?? t.errors.unavailable) : null;
  return (
    <section className="admin-main">
      <div className="panel-intro"><span className="panel-overline">{t.overline}</span><h1>{m.admin.title}</h1><p>{t.why}</p></div>
      <section className="surface-panel two-factor-panel">
        {!flow.available ? (
          <p className="admin-note" role="alert">{t.errors.unavailable}</p>
        ) : flow.linked ? (
          <form action={verifyTwoFactorAction} className="two-factor-form">
            <span className="two-factor-icon"><KeyRound size={22} /></span>
            <h2>{t.promptTitle}</h2>
            <p>{linked ? t.linked : t.promptText}</p>
            <CodeField />
            {errorText && <p className="form-error" role="alert">{errorText}</p>}
            <button type="submit" className="button-primary"><ShieldCheck size={15} />{t.verify}</button>
          </form>
        ) : (
          <form action={linkTwoFactorAction} className="two-factor-form">
            <span className="two-factor-icon"><Smartphone size={22} /></span>
            <h2>{t.setupTitle}</h2>
            <ol className="two-factor-steps">{t.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            {/* Kratos makes the QR code (a data: image), so it never leaves our servers. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="two-factor-qr" src={flow.setup.qr} alt={t.qrAlt} width={200} height={200} />
            <p className="two-factor-secret"><span>{t.secretLabel}</span><code dir="ltr">{flow.setup.secret}</code></p>
            <input type="hidden" name="flow" value={flow.setup.flowId} />
            <CodeField />
            {errorText && <p className="form-error" role="alert">{errorText}</p>}
            <button type="submit" className="button-primary"><ShieldCheck size={15} />{t.link}</button>
          </form>
        )}
      </section>
    </section>
  );
}

const DEMO_KEY = "m2smart-demo-second-step";

/** The demo's second step: the same screen, any six digits, remembered for this browser tab. */
export function DemoTwoFactor({ children }: { children: ReactNode }) {
  const { m } = useI18n();
  const t = m.admin.twoFactor;
  const [passed, setPassed] = useState(false);
  const [code, setCode] = useState("");
  useEffect(() => {
    try {
      setPassed(window.sessionStorage.getItem(DEMO_KEY) === "1");
    } catch {
      // Storage blocked: the step is asked again, which is fine.
    }
  }, []);
  if (passed) return <>{children}</>;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) return;
    try {
      window.sessionStorage.setItem(DEMO_KEY, "1");
    } catch {
      // Not remembered; the panel opens anyway.
    }
    setPassed(true);
  };
  return (
    <section className="admin-main">
      <div className="panel-intro"><span className="panel-overline">{t.overline} · DEMO</span><h1>{m.admin.title}</h1><p>{t.why}</p></div>
      <section className="surface-panel two-factor-panel">
        <form className="two-factor-form" onSubmit={submit}>
          <span className="two-factor-icon"><KeyRound size={22} /></span>
          <h2>{t.promptTitle}</h2>
          <p>{t.promptText}</p>
          <p className="form-note">{t.demoNote}</p>
          <label className="form-field">
            <span>{t.codeLabel}</span>
            <input value={code} onChange={(event) => setCode(event.target.value.replace(/[^\d\s]/g, ""))} inputMode="numeric" autoComplete="one-time-code" maxLength={7} required dir="ltr" className="two-factor-code" autoFocus />
          </label>
          <button type="submit" className="button-primary" disabled={!/^\d{6}$/.test(code.replace(/\s/g, ""))}><ShieldCheck size={15} />{t.verify}</button>
        </form>
      </section>
    </section>
  );
}
