"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, House, KeyRound, Languages, LockKeyhole, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import {
  sendLoginCodeAction,
  sendRegistrationCodeAction,
  signInAction,
  updatePasswordAction,
  verifyLoginCodeAction,
  verifyRegistrationCodeAction,
} from "@/app/(auth)/actions";
import type { Locale } from "@/lib/i18n";
import type { DemoCredentials, LoginMethod } from "@/lib/auth";
import { maskPhone } from "@/lib/auth/phone";

type AuthMode = "login" | "register" | "forgot" | "update";

const messages = {
  en: {
    signIn: "Welcome back",
    signInSubtitle: "Your home is right where you left it.",
    register: "A home, made yours.",
    registerSmsSubtitle: "We’ll text you a code to confirm your number. You can add a password later.",
    forgot: "Let’s get you back in.",
    forgotSmsSubtitle: "No problem. Sign in with a code we text to your phone, then choose a new password.",
    update: "Choose a new password.",
    updateSubtitle: "Make it long, unique, and yours alone.",
    phone: "Mobile number",
    phonePlaceholder: "0912 345 6789",
    code: "6-digit code",
    codeSentTo: "We texted a code to",
    password: "Password",
    passwordPlaceholder: "At least 12 characters",
    fullName: "Your name",
    fullNamePlaceholder: "How should we greet you?",
    confirmPassword: "Confirm password",
    signInButton: "Sign in",
    sendCode: "Send code",
    verifySignIn: "Verify and sign in",
    verifyCreate: "Verify and create account",
    resendCode: "Send a new code",
    changeNumber: "Change number",
    usePassword: "Sign in with a password",
    useCode: "Sign in with an SMS code",
    createAccount: "Create account",
    savePassword: "Update password",
    noAccount: "New to M2smart?",
    haveAccount: "Already have an account?",
    registerLink: "Create an account",
    signInLink: "Sign in",
    forgotLink: "Forgot password?",
    backToSignIn: "Back to sign in",
    legal: "By continuing, you agree to our Terms and Privacy Policy.",
    secure: "Your homes stay private to your account.",
    demoTitle: "Demo account · shared sandbox",
    demoNote: "For walkthroughs only. This account uses sample data and cannot access real homes.",
    demoEnter: "Enter the demo",
    errorDemoCredentials: "Those demo credentials don’t match. Use the credentials shown above.",
    privateByDesign: "A little more at home.",
    privateSubtitle: "Every home. Every little detail. Just yours.",
    errorSetup: "Sign-in isn’t set up on this server yet.",
    errorUnavailable: "The sign-in service isn’t reachable right now. Please try again in a moment.",
    errorCredentials: "Those sign-in details don’t match. Check them and try again.",
    errorRequired: "Please complete all required fields.",
    errorWeakPassword: "Use a password with at least 12 characters.",
    errorPasswordMismatch: "Those passwords don’t match.",
    errorSignup: "We couldn’t create that account. Check the details or try signing in.",
    errorUpdate: "We couldn’t update the password. Please try again.",
    errorPhoneInvalid: "Enter a valid mobile number, like 0912 345 6789.",
    errorNoAccount: "There’s no account for this number yet. Create one to get started.",
    errorPhoneTaken: "This number already has an account. Sign in instead.",
    errorCodeInvalid: "That code isn’t right. Check the SMS and try again.",
    errorCodeAttempts: "Too many wrong codes. Request a new code to try again.",
    errorFlowExpired: "That code has expired. Enter your number to get a new one.",
    noticeSignedOut: "You’ve signed out securely.",
    noticeReauth: "For your security, sign in again with an SMS code to set your password.",
    featureHome: "One account, all your homes",
    featureSecurity: "Private by design",
    featureControl: "Your home, in sync",
  },
  fa: {
    signIn: "خوش برگشتید",
    signInSubtitle: "خانه همان‌جاست که رهایش کرده‌اید.",
    register: "خانه‌ای به سلیقه‌ی شما.",
    registerSmsSubtitle: "برای تأیید شماره یک کد برایتان پیامک می‌کنیم. بعداً می‌توانید رمز عبور هم بگذارید.",
    forgot: "دوباره وارد خانه شوید.",
    forgotSmsSubtitle: "مشکلی نیست. با کدی که پیامک می‌کنیم وارد شوید و رمز تازه انتخاب کنید.",
    update: "رمز تازه انتخاب کنید.",
    updateSubtitle: "رمزی طولانی و منحصربه‌فرد انتخاب کنید.",
    phone: "شماره‌ی موبایل",
    phonePlaceholder: "0912 345 6789",
    code: "کد ۶ رقمی",
    codeSentTo: "کد به این شماره پیامک شد:",
    password: "رمز عبور",
    passwordPlaceholder: "حداقل ۱۲ نویسه",
    fullName: "نام شما",
    fullNamePlaceholder: "دوست دارید چطور صدایتان کنیم؟",
    confirmPassword: "تکرار رمز عبور",
    signInButton: "ورود",
    sendCode: "ارسال کد",
    verifySignIn: "تأیید و ورود",
    verifyCreate: "تأیید و ساخت حساب",
    resendCode: "ارسال دوباره‌ی کد",
    changeNumber: "تغییر شماره",
    usePassword: "ورود با رمز عبور",
    useCode: "ورود با کد پیامکی",
    createAccount: "ساخت حساب",
    savePassword: "به‌روزرسانی رمز",
    noAccount: "تازه به M2smart پیوسته‌اید؟",
    haveAccount: "از قبل حساب دارید؟",
    registerLink: "ساخت حساب",
    signInLink: "ورود",
    forgotLink: "رمز را فراموش کرده‌اید؟",
    backToSignIn: "بازگشت به ورود",
    legal: "با ادامه، شرایط استفاده و سیاست حریم خصوصی را می‌پذیرید.",
    secure: "خانه‌های شما فقط در دسترس حساب خودتان هستند.",
    privateByDesign: "کمی بیشتر در خانه.",
    privateSubtitle: "تمام خانه‌ها و جزئیات، فقط برای شما.",
    errorSetup: "ورود هنوز روی این سرور راه‌اندازی نشده است.",
    errorUnavailable: "سرویس ورود الان در دسترس نیست. لحظاتی بعد دوباره تلاش کنید.",
    errorCredentials: "اطلاعات ورود درست نیست. دوباره بررسی کنید.",
    errorRequired: "لطفاً همه‌ی فیلدهای الزامی را کامل کنید.",
    errorWeakPassword: "رمزی با حداقل ۱۲ نویسه انتخاب کنید.",
    errorPasswordMismatch: "رمزها با هم یکسان نیستند.",
    errorSignup: "ساخت حساب انجام نشد. اطلاعات را بررسی کنید یا وارد شوید.",
    errorUpdate: "به‌روزرسانی رمز انجام نشد. دوباره تلاش کنید.",
    errorPhoneInvalid: "یک شماره‌ی موبایل معتبر وارد کنید، مثل ۰۹۱۲۳۴۵۶۷۸۹.",
    errorNoAccount: "هنوز حسابی با این شماره نیست. برای شروع حساب بسازید.",
    errorPhoneTaken: "این شماره قبلاً حساب دارد. وارد شوید.",
    errorCodeInvalid: "کد درست نیست. پیامک را بررسی کنید و دوباره وارد کنید.",
    errorCodeAttempts: "تعداد تلاش‌های اشتباه زیاد شد. یک کد تازه بگیرید.",
    errorFlowExpired: "مهلت این کد تمام شده. شماره را وارد کنید تا کد تازه بگیرید.",
    noticeSignedOut: "با امنیت از حساب خارج شدید.",
    noticeReauth: "برای امنیت حساب، دوباره با کد پیامکی وارد شوید تا رمز را تنظیم کنید.",
    featureHome: "یک حساب، تمام خانه‌ها",
    featureSecurity: "حریم خصوصی از ابتدا",
    featureControl: "خانه‌ی هماهنگ با شما",
    demoTitle: "حساب دمو · محیط آزمایشی",
    demoNote: "فقط برای نمایش است. این حساب داده‌ی نمونه دارد و به خانه‌ی واقعی دسترسی ندارد.",
    demoEnter: "ورود به دمو",
    errorDemoCredentials: "اطلاعات دمو درست نیست؛ از مشخصات نمایشی بالا استفاده کنید.",
  },
} as const;

type Copy = (typeof messages)[Locale];

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
  const [locale, setLocale] = useState<Locale>("en");
  const [passwordMode, setPasswordMode] = useState(initialPasswordMode);
  const isRtl = locale === "fa";
  const copy = messages[locale];
  const sms = mode === "login" ? loginMethods.includes("sms_code") : configured;
  const codeStep = sms && Boolean(flowId) && (mode === "login" || mode === "register");
  const nextPath = safeNext(next);

  const title = mode === "login" ? copy.signIn : mode === "register" ? copy.register : mode === "forgot" ? copy.forgot : copy.update;
  const subtitle =
    mode === "login"
      ? copy.signInSubtitle
      : mode === "register"
        ? copy.registerSmsSubtitle
        : mode === "forgot"
          ? copy.forgotSmsSubtitle
          : copy.updateSubtitle;
  const errorMessage = error ? errorText(error, copy) : configured ? "" : copy.errorSetup;
  const noticeMessage = notice ? noticeText(notice, copy) : "";

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("m2smart-locale") ?? window.localStorage.getItem("mehr-locale");
      if (stored === "fa" || stored === "en") setLocale(stored);
    } catch {
      // Keep the default locale when browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
  }, [isRtl, locale]);

  const changeLocale = () => {
    const nextLocale = locale === "en" ? "fa" : "en";
    setLocale(nextLocale);
    try {
      window.localStorage.setItem("m2smart-locale", nextLocale);
    } catch {
      // Locale switching still works for the current page.
    }
  };

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
          <input className="auth-code-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9۰-۹]{6}" maxLength={6} dir="ltr" required autoFocus placeholder="••••••" />
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
    <div className={`auth-page${isRtl ? " app-rtl" : ""}`} dir={isRtl ? "rtl" : "ltr"}>
      <aside className="auth-visual">
        <div className="auth-photo" />
        <div className="auth-photo-shade" />
        <div className="auth-brand"><span className="m2-mark">M2</span><span>M2smart</span><span className="auth-brand-caption">HOME</span></div>
        <div className="auth-visual-copy"><span className="auth-overline"><span />{isRtl ? "خانه، با آرامش بیشتر" : "A MORE THOUGHTFUL HOME"}</span><h2>{copy.privateByDesign}</h2><p>{copy.privateSubtitle}</p></div>
        <div className="auth-feature-list"><span><House size={15} />{copy.featureHome}</span><span><ShieldCheck size={15} />{copy.featureSecurity}</span><span><Sparkles size={15} />{copy.featureControl}</span></div>
        <span className="auth-image-credit">M2SMART · PRIVATE RESIDENCE</span>
      </aside>

      <section className="auth-panel">
        <header className="auth-topline">
          <span className="auth-mobile-brand"><span className="m2-mark">M2</span>M2smart</span>
          <button className="auth-language" type="button" onClick={changeLocale} aria-label={isRtl ? "Switch to English" : "تغییر زبان به فارسی"}><Languages size={16} /><span>{isRtl ? "EN" : "فارسی"}</span></button>
        </header>

        <div className="auth-form-wrap" key={`${mode}-${locale}-${codeStep}-${passwordMode}`}>
          <div className="auth-lock-icon">{codeStep ? <MessageSquareText size={19} /> : <LockKeyhole size={19} />}</div>
          <span className="auth-overline">{mode === "register" ? (isRtl ? "شروع عضویت" : "YOUR HOME, CONNECTED") : mode === "login" ? (isRtl ? "ورود امن" : "SECURE SIGN IN") : (isRtl ? "امنیت حساب" : "ACCOUNT SECURITY")}</span>
          <h1>{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>

          {errorMessage && <div className="auth-message auth-error" role="alert"><ShieldCheck size={16} /><span>{errorMessage}</span></div>}
          {noticeMessage && <div className="auth-message auth-notice" role="status"><Check size={16} /><span>{noticeMessage}</span></div>}

          {mode === "login" && demoCredentials && !codeStep && <section className="auth-demo-card" aria-label={copy.demoTitle}>
            <span className="auth-demo-heading"><Sparkles size={14} />{copy.demoTitle}</span>
            <p>{copy.demoNote}</p>
            <dl>
              <div><dt>{isRtl ? "نام کاربری" : "Username"}</dt><dd dir="ltr">{demoCredentials.username}</dd></div>
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

function errorText(code: string, copy: Copy): string {
  const key: Record<string, keyof Copy> = {
    setup: "errorSetup",
    unavailable: "errorUnavailable",
    credentials: "errorCredentials",
    "demo-credentials": "errorDemoCredentials",
    required: "errorRequired",
    "weak-password": "errorWeakPassword",
    "password-mismatch": "errorPasswordMismatch",
    "signup-failed": "errorSignup",
    "update-failed": "errorUpdate",
    "phone-invalid": "errorPhoneInvalid",
    "no-account": "errorNoAccount",
    "phone-taken": "errorPhoneTaken",
    "code-invalid": "errorCodeInvalid",
    "code-attempts": "errorCodeAttempts",
    "flow-expired": "errorFlowExpired",
  };
  return copy[key[code] ?? "errorCredentials"];
}

function noticeText(code: string, copy: Copy): string {
  const key: Record<string, keyof Copy> = {
    "signed-out": "noticeSignedOut",
    reauth: "noticeReauth",
  };
  return copy[key[code] ?? "noticeSignedOut"];
}

function safeNext(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}
