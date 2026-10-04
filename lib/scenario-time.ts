/**
 * Scenario times in the home's time zone, in the browser: the demo's "next run" (the API computes
 * it for real homes) and the date picker. Uses only Intl (works offline); daylight saving comes
 * from the browser's time zone database.
 */
import { gregorianToJalali, isoDate, jalaliMonthLength, jalaliToGregorian, type Calendar, type Scenario } from "@m2smart/contracts";

type LocalParts = { year: number; month: number; day: number; weekday: number; hour: number; minute: number };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The wall-clock date and time of `date` in `timeZone`. */
export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: WEEKDAYS.indexOf(parts.weekday), hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** The instant when the wall clock in `timeZone` shows `date` ("YYYY-MM-DD") at `time` ("HH:MM"). */
export function zonedToInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Two rounds settle the offset, also next to a daylight-saving change.
  let guess = wall;
  for (let round = 0; round < 2; round++) {
    const seen = localParts(new Date(guess), timeZone);
    guess += wall - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  }
  return new Date(guess);
}


/** The next time a scheduled scenario runs after `now`, or null (themed, off, or over). */
export function nextRun(scenario: Pick<Scenario, "kind" | "enabled" | "weekdays" | "time" | "date" | "lastRun">, timeZone: string, now = new Date()): Date | null {
  if (!scenario.enabled || !scenario.time) return null;
  if (scenario.kind === "one_time" && scenario.date) {
    const at = zonedToInstant(scenario.date, scenario.time, timeZone);
    return at > now && !scenario.lastRun ? at : null;
  }
  if (scenario.kind !== "periodic" || !scenario.weekdays?.length) return null;
  const today = localParts(now, timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (!scenario.weekdays.includes(day.getUTCDay() as never)) continue;
    const at = zonedToInstant(isoDate({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() }), scenario.time, timeZone);
    if (at > now) return at;
  }
  return null;
}

/** A Gregorian "YYYY-MM-DD" as year/month/day of the user's calendar. */
export function toCalendarDate(date: string, calendar: Calendar): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  if (calendar === "gregorian") return { year, month, day };
  return gregorianToJalali({ year, month, day });
}

/** Year/month/day of the user's calendar as a Gregorian "YYYY-MM-DD". */
export function fromCalendarDate(parts: { year: number; month: number; day: number }, calendar: Calendar): string {
  return isoDate(calendar === "gregorian" ? parts : jalaliToGregorian(parts));
}

/** Days in a month of the user's calendar. */
export function monthLength(year: number, month: number, calendar: Calendar): number {
  if (calendar === "gregorian") return new Date(Date.UTC(year, month, 0)).getUTCDate();
  return jalaliMonthLength(year, month);
}
