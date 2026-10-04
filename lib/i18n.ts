/**
 * Languages of the app: Persian, English and Arabic. All text lives in messages/*.ts; the
 * English file is the reference and its shape is enforced on the others.
 *
 * The chosen language is kept in a cookie, so the server renders the page in that language and
 * direction from the first byte (no flash of the wrong language).
 */
import { ar } from "@/messages/ar";
import { en, type Messages } from "@/messages/en";
import { fa } from "@/messages/fa";

export type { Messages } from "@/messages/en";

export const locales = ["fa", "en", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
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
