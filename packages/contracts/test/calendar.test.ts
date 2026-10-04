import { describe, expect, it } from "vitest";
import { gregorianToJalali, isLeapJalaliYear, isoDate, isTimeZone, isValidJalaliDate, jalaliMonthLength, jalaliToGregorian } from "../src/calendar.js";

const persian = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });
/** What the browser shows for a Gregorian date in the Solar Hijri calendar (the display oracle). */
function intlJalali(year: number, month: number, day: number) {
  const parts = Object.fromEntries(persian.formatToParts(new Date(Date.UTC(year, month - 1, day))).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

describe("Solar Hijri ⇄ Gregorian", () => {
  it("knows the dates people know", () => {
    expect(jalaliToGregorian({ year: 1403, month: 1, day: 1 })).toEqual({ year: 2024, month: 3, day: 20 });
    expect(jalaliToGregorian({ year: 1404, month: 1, day: 1 })).toEqual({ year: 2025, month: 3, day: 21 });
    expect(gregorianToJalali({ year: 2026, month: 10, day: 4 })).toEqual({ year: 1405, month: 7, day: 12 });
    expect(jalaliToGregorian({ year: 1357, month: 11, day: 22 })).toEqual({ year: 1979, month: 2, day: 11 });
  });

  it("converts 20 Mordad 1407 (the product owner's example) the same way the screen shows it", () => {
    const gregorian = jalaliToGregorian({ year: 1407, month: 5, day: 20 });
    expect(intlJalali(gregorian.year, gregorian.month, gregorian.day)).toEqual({ year: 1407, month: 5, day: 20 });
    expect(isoDate(gregorian)).toMatch(/^2028-08-1\d$/);
  });

  it("agrees with the browser's Solar Hijri calendar on every day from 1925 to 2150", () => {
    const mismatches: string[] = [];
    for (let time = Date.UTC(1925, 0, 1); time <= Date.UTC(2150, 11, 31); time += 86_400_000) {
      const date = new Date(time);
      const gregorian = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
      const expected = intlJalali(gregorian.year, gregorian.month, gregorian.day);
      const jalali = gregorianToJalali(gregorian);
      if (jalali.year !== expected.year || jalali.month !== expected.month || jalali.day !== expected.day) mismatches.push(`${isoDate(gregorian)}: ${JSON.stringify(jalali)} ≠ ${JSON.stringify(expected)}`);
      else if (isoDate(jalaliToGregorian(jalali)) !== isoDate(gregorian)) mismatches.push(`${isoDate(gregorian)}: no round trip`);
      if (mismatches.length > 5) break;
    }
    expect(mismatches).toEqual([]);
  });

  it("knows month lengths and leap years", () => {
    expect(jalaliMonthLength(1403, 1)).toBe(31);
    expect(jalaliMonthLength(1403, 7)).toBe(30);
    expect(isLeapJalaliYear(1403)).toBe(true);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(isLeapJalaliYear(1404)).toBe(false);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
  });

  it("rejects dates that do not exist", () => {
    expect(isValidJalaliDate({ year: 1404, month: 12, day: 30 })).toBe(false);
    expect(isValidJalaliDate({ year: 1404, month: 7, day: 31 })).toBe(false);
    expect(isValidJalaliDate({ year: 1404, month: 13, day: 1 })).toBe(false);
    expect(() => jalaliToGregorian({ year: 1404, month: 12, day: 30 })).toThrow(RangeError);
  });
});

describe("time zones", () => {
  it("accepts IANA zones and nothing else", () => {
    for (const zone of ["Asia/Tehran", "Europe/Istanbul", "America/New_York", "UTC", "America/Argentina/Buenos_Aires"]) expect(isTimeZone(zone), zone).toBe(true);
    for (const zone of ["Mars/Olympus", "Tehran", "", "Asia/Tehran; drop table", 42]) expect(isTimeZone(zone), String(zone)).toBe(false);
  });
});
