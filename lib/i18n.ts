/**
 * Languages of the app: Persian, English and Arabic. All text lives in messages/*.ts; the
 * English file is the reference and its shape is enforced on the others.
 *
 * The chosen language is kept in a cookie, so the server renders the page in that language and
 * direction from the first byte (no flash of the wrong language).
 */
import type { Calendar } from "@m2smart/contracts";
import { ar } from "@/messages/ar";
import { en, type Messages } from "@/messages/en";
import { fa } from "@/messages/fa";

export type { Messages } from "@/messages/en";
export type { Calendar, TemperatureUnit, UserSettings } from "@m2smart/contracts";

export const locales = ["fa", "en", "ar"] as const;
export type Locale = (typeof locales)[number];
export const LOCALE_COOKIE = "m2smart-locale";

export const messages: Record<Locale, Messages> = { en, fa, ar };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function isRtl(locale: Locale): boolean {
  return messages[locale].meta.dir === "rtl";
}

/** Intl locale with the numbering system of each language: ۰۱۲ (Persian), ٠١٢ (Arabic), 012. */
const numberLocales: Record<Locale, string> = { fa: "fa-IR-u-nu-arabext", ar: "ar-u-nu-arab", en: "en-US" };

export function formatNumber(value: number, locale: Locale, fractionDigits = 0): string {
  return new Intl.NumberFormat(numberLocales[locale], { maximumFractionDigits: fractionDigits }).format(value);
}

export const CALENDAR_COOKIE = "m2smart-calendar";
export const TEMPERATURE_COOKIE = "m2smart-temperature";

const dateLocales: Record<Locale, string> = { fa: "fa-IR", ar: "ar", en: "en-US" };
const numberingSystems: Record<Locale, string> = { fa: "arabext", ar: "arab", en: "latn" };

/**
 * A date in the user's language and calendar (Solar Hijri or Gregorian), as it is in `timeZone`
 * (the home's time zone, not the phone's). Uses the browser's built-in calendars; works offline.
 */
export function formatDate(date: Date, locale: Locale, calendar: Calendar, timeZone: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" }): string {
  const tag = `${dateLocales[locale]}-u-ca-${calendar === "solar_hijri" ? "persian" : "gregory"}-nu-${numberingSystems[locale]}`;
  return new Intl.DateTimeFormat(tag, { ...options, timeZone }).format(date);
}
