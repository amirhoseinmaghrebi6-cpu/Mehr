"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isLocale, isRtl, LOCALE_COOKIE, messages, type Locale, type Messages } from "@/lib/i18n";

type I18n = { locale: Locale; m: Messages; rtl: boolean; setLocale: (locale: Locale) => void };

const I18nContext = createContext<I18n | null>(null);

/** Provides the language chosen in the cookie (read by the server for the first render). */
export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  // A language chosen before the cookie existed (older builds kept it in localStorage).
  useEffect(() => {
    if (document.cookie.includes(`${LOCALE_COOKIE}=`)) return;
    try {
      const stored = window.localStorage.getItem("m2smart-locale");
      if (isLocale(stored) && stored !== initialLocale) setLocale(stored);
    } catch {
      // Storage unavailable: keep the default.
    }
  }, [initialLocale, setLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
  }, [locale]);

  const value = useMemo(() => ({ locale, m: messages[locale], rtl: isRtl(locale), setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
