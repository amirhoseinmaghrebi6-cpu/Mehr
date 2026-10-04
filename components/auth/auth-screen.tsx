"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, House, KeyRound, LockKeyhole, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import {
  sendLoginCodeAction,
  sendRegistrationCodeAction,
  signInAction,
  updatePasswordAction,
  verifyLoginCodeAction,
  verifyRegistrationCodeAction,
} from "@/app/(auth)/actions";
import { useI18n } from "@/components/i18n-provider";
import { LanguageMenu } from "@/components/language-menu";
import type { DemoCredentials, LoginMethod } from "@/lib/auth";
import { maskPhone } from "@/lib/auth/phone";

type AuthMode = "login" | "register" | "forgot" | "update";

type AuthScreenProps = {
  mode: AuthMode;
  error?: string;
  notice?: string;
  next?: string;
  configured: boolean;
  demoCredentials?: DemoCredentials | null;
  /** Sign-in methods the server offers; SMS code first when present. */
  loginMethods?: LoginMethod[];
  /** Set once a code was sent: the screen shows the code step. */
  flowId?: string;
  /** E.164 number the code went to (or was entered). */
  phone?: string;
  passwordMode?: boolean;
};

export function AuthScreen({
  mode,
  error,
  notice,
  next,
  configured,
  demoCredentials,
  loginMethods = [],
  flowId,
  phone,
  passwordMode: initialPasswordMode = false,
}: AuthScreenProps) {
  const { locale, m, rtl } = useI18n();
  const copy = m.auth;
  const [passwordMode, setPasswordMode] = useState(initialPasswordMode);
  const sms = mode === "login" ? loginMethods.includes("sms_code") : configured;
  const codeStep = sms && Boolean(flowId) && (mode === "login" || mode === "register");
  const nextPath = safeNext(next);

  const title = mode === "login" ? copy.signIn : mode === "register" ? copy.register : mode === "forgot" ? copy.forgot : copy.update;
  const subtitle = mode === "login" ? copy.signInSubtitle : mode === "register" ? copy.registerSubtitle : mode === "forgot" ? copy.forgotSubtitle : copy.updateSubtitle;
  const errorMessage = error ? (copy.errors[error] ?? copy.errors.credentials) : configured ? "" : copy.errors.setup;
  const noticeMessage = notice ? (copy.notices[notice] ?? copy.notices["signed-out"]) : "";

  const phoneField = (
    <label className="auth-field">
      <span>{copy.phone}</span>
      <input name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required maxLength={20} defaultValue={phone ?? ""} placeholder={copy.phonePlaceholder} />
    </label>
  );

  const codeForm = (action: (formData: FormData) => Promise<void>, submitLabel: string, restartHref: string) => (
    <>
      <form className="auth-form" action={action}>
        <input type="hidden" name="flow" value={flowId} />
        <input type="hidden" name="phone" value={phone ?? ""} />
        <input type="hidden" name="next" value={nextPath} />
        <p className="auth-code-target">{copy.codeSentTo} <bdi dir="ltr">{phone ? maskPhone(phone) : ""}</bdi></p>
        <label className="auth-field">
          <span>{copy.code}</span>
          <input className="auth-code-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9۰-۹٠-٩]{6}" maxLength={6} dir="ltr" required autoFocus placeholder="••••••" />
        </label>
        <button className="auth-submit" type="submit">{submitLabel}<Check size={16} /></button>
      </form>
      <div className="auth-inline-actions">
        <Link href={restartHref}>{copy.changeNumber}</Link>
        {mode === "login" && (
          <form action={sendLoginCodeAction}>
            <input type="hidden" name="phone" value={phone ?? ""} />
            <input type="hidden" name="next" value={nextPath} />
            <button className="auth-link-button" type="submit">{copy.resendCode}</button>
          </form>
        )}
      </div>
    </>
  );

  return (
    <div className={`auth-page${rtl ? " app-rtl" : ""}`} dir={rtl ? "rtl" : "ltr"}>
      <aside className="auth-visual">
        <div className="auth-photo" />
        <div className="auth-photo-shade" />
        <div className="auth-brand"><span className="m2-mark">M2</span><span>M2smart</span><span className="auth-brand-caption">HOME</span></div>
        <div className="auth-visual-copy"><span className="auth-overline"><span />{copy.visualOverline}</span><h2>{copy.visualTitle}</h2><p>{copy.visualSubtitle}</p></div>
        <div className="auth-feature-list"><span><House size={15} />{copy.featureHome}</span><span><ShieldCheck size={15} />{copy.featureSecurity}</span><span><Sparkles size={15} />{copy.featureControl}</span></div>
        <span className="auth-image-credit">M2SMART · PRIVATE RESIDENCE</span>
      </aside>

      <section className="auth-panel">
        <header className="auth-topline">
          <span className="auth-mobile-brand"><span className="m2-mark">M2</span>M2smart</span>
          <LanguageMenu className="auth-language" />
        </header>

        <div className="auth-form-wrap" key={`${mode}-${locale}-${codeStep}-${passwordMode}`}>
          <div className="auth-lock-icon">{codeStep ? <MessageSquareText size={19} /> : <LockKeyhole size={19} />}</div>
          <span className="auth-overline">{mode === "register" ? copy.overlineRegister : mode === "login" ? copy.overlineSignIn : copy.overlineSecurity}</span>
          <h1>{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>

          {errorMessage && <div className="auth-message auth-error" role="alert"><ShieldCheck size={16} /><span>{errorMessage}</span></div>}
          {noticeMessage && <div className="auth-message auth-notice" role="status"><Check size={16} /><span>{noticeMessage}</span></div>}

          {mode === "login" && demoCredentials && !codeStep && <section className="auth-demo-card" aria-label={copy.demoTitle}>
            <span className="auth-demo-heading"><Sparkles size={14} />{copy.demoTitle}</span>
            <p>{copy.demoNote}</p>
            <dl>
              <div><dt>{copy.username}</dt><dd dir="ltr">{demoCredentials.username}</dd></div>
              <div><dt>{copy.password}</dt><dd dir="ltr">{demoCredentials.password}</dd></div>
            </dl>
            <form action={signInAction}>
              <input type="hidden" name="method" value="password" />
              <input type="hidden" name="identifier" value={demoCredentials.username} />
              <input type="hidden" name="password" value={demoCredentials.password} />
              <input type="hidden" name="next" value={nextPath} />
              <button type="submit">{copy.demoEnter}</button>
            </form>
          </section>}

          {mode === "login" && sms && codeStep && codeForm(verifyLoginCodeAction, copy.verifySignIn, `/login?next=${encodeURIComponent(nextPath)}`)}

          {mode === "login" && sms && !codeStep && !passwordMode && (
            <form className="auth-form" action={sendLoginCodeAction}>
              <input type="hidden" name="next" value={nextPath} />
              {phoneField}
              <button className="auth-submit" type="submit">{copy.sendCode}<MessageSquareText size={16} /></button>
              {loginMethods.includes("password") && <button className="auth-link-button" type="button" onClick={() => setPasswordMode(true)}><KeyRound size={13} />{copy.usePassword}</button>}
            </form>
          )}

          {mode === "login" && sms && !codeStep && passwordMode && (
            <form className="auth-form" action={signInAction}>
              <input type="hidden" name="method" value="password" />
              <input type="hidden" name="next" value={nextPath} />
              <label className="auth-field"><span>{copy.phone}</span><input name="identifier" type="tel" inputMode="tel" autoComplete="username" dir="ltr" required maxLength={20} defaultValue={phone ?? ""} placeholder={copy.phonePlaceholder} /></label>
              <label className="auth-field"><span>{copy.password}<Link href={`/login?next=${encodeURIComponent("/update-password")}`}>{copy.forgotLink}</Link></span><input name="password" type="password" autoComplete="current-password" dir="ltr" required placeholder="••••••••••••" /></label>
              <button className="auth-submit" type="submit">{copy.signInButton}<ArrowRight size={16} /></button>
              <button className="auth-link-button" type="button" onClick={() => setPasswordMode(false)}><MessageSquareText size={13} />{copy.useCode}</button>
            </form>
          )}

          {mode === "register" && sms && codeStep && codeForm(verifyRegistrationCodeAction, copy.verifyCreate, "/register")}

          {mode === "register" && sms && !codeStep && (
            <form className="auth-form" action={sendRegistrationCodeAction}>
              <label className="auth-field"><span>{copy.fullName}</span><input name="fullName" type="text" autoComplete="name" required minLength={2} maxLength={80} placeholder={copy.fullNamePlaceholder} /></label>
              {phoneField}
              <button className="auth-submit" type="submit">{copy.sendCode}<MessageSquareText size={16} /></button>
              <p className="auth-legal">{copy.legal}</p>
            </form>
          )}

          {mode === "forgot" && sms && (
            <div className="auth-form">
              <Link className="auth-submit" href={`/login?next=${encodeURIComponent("/update-password")}`}>{copy.useCode}<MessageSquareText size={16} /></Link>
              <Link className="auth-back-link" href="/login"><ArrowLeft size={15} />{copy.backToSignIn}</Link>
            </div>
          )}

          {mode === "update" && (
            <form className="auth-form" action={updatePasswordAction}>
              <label className="auth-field"><span>{copy.password}</span><input name="password" type="password" autoComplete="new-password" dir="ltr" required minLength={12} maxLength={128} placeholder={copy.passwordPlaceholder} /></label>
              <label className="auth-field"><span>{copy.confirmPassword}</span><input name="confirmPassword" type="password" autoComplete="new-password" dir="ltr" required minLength={12} maxLength={128} placeholder="••••••••••••" /></label>
              <button className="auth-submit" type="submit">{copy.savePassword}<Check size={16} /></button>
            </form>
          )}

          {(mode === "login" || mode === "register") && !codeStep && <div className="auth-switch">{mode === "login" ? <>{copy.noAccount}<Link href="/register">{copy.registerLink}</Link></> : <>{copy.haveAccount}<Link href="/login">{copy.signInLink}</Link></>}</div>}
        </div>

        <footer className="auth-footer"><span><span className="auth-footer-dot" />{copy.secure}</span><span>© 2026 M2SMART</span></footer>
      </section>
    </div>
  );
}

function safeNext(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}
