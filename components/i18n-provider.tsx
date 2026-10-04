"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CALENDAR_COOKIE, isLocale, isRtl, LOCALE_COOKIE, messages, PALETTE_COOKIE, TEMPERATURE_COOKIE, type Calendar, type Locale, type Messages, type Palette, type TemperatureUnit, type UserSettings } from "@/lib/i18n";

type Preferences = {
  locale: Locale;
  m: Messages;
  rtl: boolean;
  calendar: Calendar;
  temperatureUnit: TemperatureUnit;
  palette: Palette;
  setLocale: (locale: Locale) => void;
  /** Applies any of the preferences (e.g. from the user's account). */
  setPreferences: (settings: Partial<UserSettings>) => void;
};

const PreferencesContext = createContext<Preferences | null>(null);

const setCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
};

/**
 * The user's display preferences: language, calendar, temperature unit, colour palette. Each is kept in a cookie
 * (read by the server for the first render) and, for signed-in users, on the account; the app shell
 * syncs the two (components/app-shell.tsx).
 */
export function I18nProvider({ initial, children }: { initial: UserSettings; children: React.ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(initial);

  const setPreferences = useCallback((next: Partial<UserSettings>) => {
    setSettings((current) => ({ ...current, ...next }));
    if (next.language) setCookie(LOCALE_COOKIE, next.language);
    if (next.calendar) setCookie(CALENDAR_COOKIE, next.calendar);
    if (next.temperatureUnit) setCookie(TEMPERATURE_COOKIE, next.temperatureUnit);
    if (next.palette) setCookie(PALETTE_COOKIE, next.palette);
  }, []);
  const setLocale = useCallback((language: Locale) => setPreferences({ language }), [setPreferences]);

  // A language chosen before the cookie existed (older builds kept it in localStorage).
  useEffect(() => {
    if (document.cookie.includes(`${LOCALE_COOKIE}=`)) return;
    try {
      const stored = window.localStorage.getItem("m2smart-locale");
      if (isLocale(stored) && stored !== initial.language) setLocale(stored);
    } catch {
      // Storage unavailable: keep the default.
    }
  }, [initial.language, setLocale]);

  useEffect(() => {
    document.documentElement.lang = settings.language;
    document.documentElement.dir = isRtl(settings.language) ? "rtl" : "ltr";
  }, [settings.language]);

  // The palette is an attribute of <html> (app/palettes.css); the server sets it for the first render.
  useEffect(() => {
    document.documentElement.dataset.palette = settings.palette;
  }, [settings.palette]);

  const value = useMemo<Preferences>(
    () => ({
      locale: settings.language,
      m: messages[settings.language],
      rtl: isRtl(settings.language),
      calendar: settings.calendar,
      temperatureUnit: settings.temperatureUnit,
      palette: settings.palette,
      setLocale,
      setPreferences,
    }),
    [settings, setLocale, setPreferences],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function useI18n(): Preferences {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
