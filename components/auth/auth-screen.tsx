"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Fingerprint, House, Languages, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import {
  requestPasswordResetAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
} from "@/app/(auth)/actions";
import type { Locale } from "@/lib/i18n";
import type { DemoCredentials } from "@/lib/demo-auth";

type AuthMode = "login" | "register" | "forgot" | "update";

const messages = {
  en: {
    signIn: "Welcome back",
    signInSubtitle: "Your home is right where you left it.",
    register: "A home, made yours.",
    registerSubtitle: "Create your M2smart account to bring your spaces together.",
    forgot: "Let’s get you back in.",
    forgotSubtitle: "We’ll send a secure link to the email on your account.",
    update: "Choose a new password.",
    updateSubtitle: "Make it long, unique, and yours alone.",
    email: "Email address",
    emailPlaceholder: "you@example.com",
    password: "Password",
    passwordPlaceholder: "At least 12 characters",
    fullName: "Your name",
    fullNamePlaceholder: "How should we greet you?",
    confirmPassword: "Confirm password",
    signInButton: "Sign in",
    createAccount: "Create account",
    sendLink: "Send secure link",
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
    demoFill: "Fill demo sign-in",
    errorDemoCredentials: "Those demo credentials don’t match. Use the credentials shown above.",
    privateByDesign: "A little more at home.",
    privateSubtitle: "Every home. Every little detail. Just yours.",
    errorSetup: "Authentication is not connected yet. Add the Supabase project URL and publishable key to the server environment to enable sign-in.",
    errorCredentials: "That email and password don’t match. Check them and try again.",
    errorRequired: "Please complete all required fields.",
    errorWeakPassword: "Use a password with at least 12 characters.",
    errorPasswordMismatch: "Those passwords don’t match.",
    errorSignup: "We couldn’t create that account. Check the details or try signing in.",
    errorVerification: "That verification link has expired or was already used. Request a new one.",
    errorResetSession: "That password-reset link is no longer valid. Request another secure link.",
    errorUpdate: "We couldn’t update the password. Request a new reset link and try again.",
    noticeVerify: "Check your inbox for a verification link to finish creating your account.",
    noticeReset: "If an account exists for that address, a password-reset link is on its way.",
    noticeSignedOut: "You’ve signed out securely.",
    featureHome: "One account, all your homes",
    featureSecurity: "Private by design",
    featureControl: "Your home, in sync",
  },
  fa: {
    signIn: "خوش برگشتید",
    signInSubtitle: "خانه همان‌جاست که رهایش کرده‌اید.",
    register: "خانه‌ای به سلیقه‌ی شما.",
    registerSubtitle: "حساب M2smart بسازید و فضاهایتان را یک‌جا داشته باشید.",
    forgot: "دوباره وارد خانه شوید.",
    forgotSubtitle: "پیوند امن را به ایمیل حساب‌تان می‌فرستیم.",
    update: "رمز تازه انتخاب کنید.",
    updateSubtitle: "رمزی طولانی و منحصربه‌فرد انتخاب کنید.",
    email: "نشانی ایمیل",
    emailPlaceholder: "you@example.com",
    password: "رمز عبور",
    passwordPlaceholder: "حداقل ۱۲ نویسه",
    fullName: "نام شما",
    fullNamePlaceholder: "دوست دارید چطور صدایتان کنیم؟",
    confirmPassword: "تکرار رمز عبور",
    signInButton: "ورود",
    createAccount: "ساخت حساب",
    sendLink: "ارسال پیوند امن",
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
    errorSetup: "احراز هویت هنوز وصل نشده است. برای فعال‌شدن ورود، نشانی پروژه و کلید عمومی Supabase را در محیط سرور تنظیم کنید.",
    errorCredentials: "ایمیل و رمز عبور با هم مطابقت ندارند. دوباره بررسی کنید.",
    errorRequired: "لطفاً همه‌ی فیلدهای الزامی را کامل کنید.",
    errorWeakPassword: "رمزی با حداقل ۱۲ نویسه انتخاب کنید.",
    errorPasswordMismatch: "رمزها با هم یکسان نیستند.",
    errorSignup: "ساخت حساب انجام نشد. اطلاعات را بررسی کنید یا وارد شوید.",
    errorVerification: "پیوند تأیید منقضی شده یا قبلاً استفاده شده است. پیوند تازه‌ای بگیرید.",
    errorResetSession: "پیوند بازیابی دیگر معتبر نیست. یک پیوند امن تازه درخواست کنید.",
    errorUpdate: "به‌روزرسانی رمز انجام نشد. پیوند بازیابی تازه‌ای بگیرید.",
    noticeVerify: "برای تکمیل ساخت حساب، پیوند تأیید را در ایمیل‌تان بررسی کنید.",
    noticeReset: "اگر حسابی با این ایمیل باشد، پیوند بازیابی رمز برایتان فرستاده می‌شود.",
    noticeSignedOut: "با امنیت از حساب خارج شدید.",
    featureHome: "یک حساب، تمام خانه‌ها",
    featureSecurity: "حریم خصوصی از ابتدا",
    featureControl: "خانه‌ی هماهنگ با شما",
    demoTitle: "حساب دمو · محیط آزمایشی",
    demoNote: "فقط برای نمایش است. این حساب داده‌ی نمونه دارد و به خانه‌ی واقعی دسترسی ندارد.",
    demoFill: "تکمیل اطلاعات دمو",
    errorDemoCredentials: "اطلاعات دمو درست نیست؛ از مشخصات نمایشی بالا استفاده کنید.",
  },
} as const;

export function AuthScreen({ mode, error, notice, email, next, configured, demoCredentials }: { mode: AuthMode; error?: string; notice?: string; email?: string; next?: string; configured: boolean; demoCredentials?: DemoCredentials | null }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [loginEmail, setLoginEmail] = useState(email ?? "");
  const [loginPassword, setLoginPassword] = useState("");
  const isRtl = locale === "fa";
  const copy = messages[locale];
  const title = mode === "login" ? copy.signIn : mode === "register" ? copy.register : mode === "forgot" ? copy.forgot : copy.update;
  const subtitle = mode === "login" ? copy.signInSubtitle : mode === "register" ? copy.registerSubtitle : mode === "forgot" ? copy.forgotSubtitle : copy.updateSubtitle;
  const errorMessage = error ? errorText(error, locale) : configured ? "" : errorText("setup", locale);
  const noticeMessage = notice ? noticeText(notice, locale) : "";
  const SubmitIcon = mode === "register" ? Sparkles : mode === "forgot" ? Fingerprint : mode === "update" ? Check : ArrowRight;

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

        <div className="auth-form-wrap" key={`${mode}-${locale}`}>
          <div className="auth-lock-icon"><LockKeyhole size={19} /></div>
          <span className="auth-overline">{mode === "register" ? (isRtl ? "شروع عضویت" : "YOUR HOME, CONNECTED") : mode === "login" ? (isRtl ? "ورود امن" : "SECURE SIGN IN") : (isRtl ? "امنیت حساب" : "ACCOUNT SECURITY")}</span>
          <h1>{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>

          {errorMessage && <div className="auth-message auth-error" role="alert"><ShieldCheck size={16} /><span>{errorMessage}</span></div>}
          {noticeMessage && <div className="auth-message auth-notice" role="status"><Check size={16} /><span>{noticeMessage}</span></div>}

          {mode === "login" && demoCredentials && <section className="auth-demo-card" aria-label={copy.demoTitle}>
            <span className="auth-demo-heading"><Sparkles size={14} />{copy.demoTitle}</span>
            <p>{copy.demoNote}</p>
            <dl>
              <div><dt>{isRtl ? "نام کاربری" : "Username"}</dt><dd dir="ltr">{demoCredentials.username}</dd></div>
              <div><dt>{copy.password}</dt><dd dir="ltr">{demoCredentials.password}</dd></div>
            </dl>
            <button type="button" onClick={() => { setLoginEmail(demoCredentials.username); setLoginPassword(demoCredentials.password); }}>{copy.demoFill}</button>
          </section>}

          {mode === "login" && (
            <form className="auth-form" action={signInAction}>
              <input type="hidden" name="next" value={safeNext(next)} />
              <label className="auth-field"><span>{copy.email}</span><input name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" required value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder={copy.emailPlaceholder} /></label>
              <label className="auth-field"><span>{copy.password}<Link href="/forgot-password">{copy.forgotLink}</Link></span><input name="password" type="password" autoComplete="current-password" dir="ltr" required minLength={1} value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder="••••••••••••" /></label>
              <button className="auth-submit" type="submit">{copy.signInButton}<SubmitIcon size={16} /></button>
            </form>
          )}

          {mode === "register" && (
            <form className="auth-form" action={signUpAction}>
              <label className="auth-field"><span>{copy.fullName}</span><input name="fullName" type="text" autoComplete="name" required minLength={2} maxLength={80} placeholder={copy.fullNamePlaceholder} /></label>
              <label className="auth-field"><span>{copy.email}</span><input name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} dir="ltr" required placeholder={copy.emailPlaceholder} /></label>
              <label className="auth-field"><span>{copy.password}</span><input name="password" type="password" autoComplete="new-password" dir="ltr" required minLength={12} maxLength={128} placeholder={copy.passwordPlaceholder} /></label>
              <label className="auth-field"><span>{copy.confirmPassword}</span><input name="confirmPassword" type="password" autoComplete="new-password" dir="ltr" required minLength={12} maxLength={128} placeholder="••••••••••••" /></label>
              <button className="auth-submit" type="submit">{copy.createAccount}<SubmitIcon size={16} /></button>
              <p className="auth-legal">{copy.legal}</p>
            </form>
          )}

          {mode === "forgot" && (
            <form className="auth-form" action={requestPasswordResetAction}>
              <label className="auth-field"><span>{copy.email}</span><input name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} dir="ltr" required defaultValue={email} placeholder={copy.emailPlaceholder} /></label>
              <button className="auth-submit" type="submit">{copy.sendLink}<Fingerprint size={16} /></button>
              <Link className="auth-back-link" href="/login"><ArrowLeft size={15} />{copy.backToSignIn}</Link>
            </form>
          )}

          {mode === "update" && (
            <form className="auth-form" action={updatePasswordAction}>
              <label className="auth-field"><span>{copy.password}</span><input name="password" type="password" autoComplete="new-password" dir="ltr" required minLength={12} maxLength={128} placeholder={copy.passwordPlaceholder} /></label>
              <label className="auth-field"><span>{copy.confirmPassword}</span><input name="confirmPassword" type="password" autoComplete="new-password" dir="ltr" required minLength={12} maxLength={128} placeholder="••••••••••••" /></label>
              <button className="auth-submit" type="submit">{copy.savePassword}<Check size={16} /></button>
            </form>
          )}

          {(mode === "login" || mode === "register") && <div className="auth-switch">{mode === "login" ? <>{copy.noAccount}<Link href="/register">{copy.registerLink}</Link></> : <>{copy.haveAccount}<Link href="/login">{copy.signInLink}</Link></>}</div>}
        </div>

        <footer className="auth-footer"><span><span className="auth-footer-dot" />{copy.secure}</span><span>© 2026 M2SMART</span></footer>
      </section>
    </div>
  );
}

function errorText(code: string, locale: Locale): string {
  const key: Record<string, keyof typeof messages.en> = {
    setup: "errorSetup",
    credentials: "errorCredentials",
    "demo-credentials": "errorDemoCredentials",
    required: "errorRequired",
    "weak-password": "errorWeakPassword",
    "password-mismatch": "errorPasswordMismatch",
    "signup-failed": "errorSignup",
    verification: "errorVerification",
    "reset-session": "errorResetSession",
    "update-failed": "errorUpdate",
  };
  return messages[locale][key[code] ?? "errorCredentials"];
}

function noticeText(code: string, locale: Locale): string {
  const key: Record<string, keyof typeof messages.en> = {
    "verify-email": "noticeVerify",
    "reset-requested": "noticeReset",
    "signed-out": "noticeSignedOut",
  };
  return messages[locale][key[code] ?? "noticeSignedOut"];
}

function safeNext(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

