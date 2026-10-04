import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { I18nProvider } from "@/components/i18n-provider";
import { calendars, defaultSettings, temperatureUnits } from "@m2smart/contracts";
import { CALENDAR_COOKIE, isLocale, isRtl, LOCALE_COOKIE, TEMPERATURE_COOKIE, type UserSettings } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "M2smart | A home that feels in sync",
  description: "A thoughtful, connected home experience by M2smart.",
  applicationName: "M2smart",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "M2smart" },
};

export const viewport: Viewport = {
  themeColor: "#f6f7f4",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The language comes from a cookie, so the first render already has the right language and
  // direction.
  const jar = await cookies();
  const stored = jar.get(LOCALE_COOKIE)?.value;
  const calendar = jar.get(CALENDAR_COOKIE)?.value;
  const temperature = jar.get(TEMPERATURE_COOKIE)?.value;
  const initial: UserSettings = {
    language: isLocale(stored) ? stored : defaultSettings.language,
    calendar: (calendars as readonly string[]).includes(calendar ?? "") ? (calendar as UserSettings["calendar"]) : defaultSettings.calendar,
    temperatureUnit: (temperatureUnits as readonly string[]).includes(temperature ?? "") ? (temperature as UserSettings["temperatureUnit"]) : defaultSettings.temperatureUnit,
  };
  const locale = initial.language;
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"} suppressHydrationWarning>
      <body>
        <I18nProvider initial={initial}>{children}</I18nProvider>
      </body>
    </html>
  );
}
