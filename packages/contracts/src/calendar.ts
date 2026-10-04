/**
 * Solar Hijri (Jalali, the Iranian calendar) ⇄ Gregorian conversion, and time zone checks.
 *
 * Dates are always stored as Gregorian; a date the user picks in Solar Hijri is converted with
 * these functions. Showing a date in Solar Hijri uses the built-in Intl "persian" calendar, and the
 * tests check these functions against it for every day of more than two centuries, so a date never
 * reads differently on screen than it is stored. Pure code: no dependency, works offline (also on
 * the hub).
 *
 * The algorithm is the well-known one by Kazimierz Borkowski, as in jalaali-js (MIT).
 */

export type DateParts = { year: number; month: number; day: number };

const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;

/** Leap state, Gregorian year of 1 Farvardin, and its day in March. */
function jalaliCalendar(jy: number): { leap: number; gy: number; march: number } {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  if (jy < jp || jy >= breaks[breaks.length - 1]) throw new RangeError(`Solar Hijri year ${jy} is out of range`);
  let jump = 0;
  for (let i = 1; i < breaks.length; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** Julian day number of a Gregorian date. */
function gregorianToDay(gy: number, gm: number, gd: number): number {
  const d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
}

function dayToGregorian(jdn: number): DateParts {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const day = div(mod(i, 153), 5) + 1;
  const month = mod(div(i, 153), 12) + 1;
  const year = div(j, 1461) - 100100 + div(8 - month, 6);
  return { year, month, day };
}

function jalaliToDay(jy: number, jm: number, jd: number): number {
  const { gy, march } = jalaliCalendar(jy);
  return gregorianToDay(gy, 3, march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function dayToJalali(jdn: number): DateParts {
  const gy = dayToGregorian(jdn).year;
  let year = gy - 621;
  const calendar = jalaliCalendar(year);
  let k = jdn - gregorianToDay(gy, 3, calendar.march);
  if (k >= 0) {
    if (k <= 185) return { year, month: 1 + div(k, 31), day: mod(k, 31) + 1 };
    k -= 186;
  } else {
    year -= 1;
    k += 179;
    if (calendar.leap === 1) k += 1;
  }
  return { year, month: 7 + div(k, 30), day: mod(k, 30) + 1 };
}

export function isLeapJalaliYear(year: number): boolean {
  return jalaliCalendar(year).leap === 0;
}

/** Farvardin–Shahrivar have 31 days, Mehr–Bahman 30, Esfand 29 (30 in a leap year). */
export function jalaliMonthLength(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  return isLeapJalaliYear(year) ? 30 : 29;
}

export function isValidJalaliDate({ year, month, day }: DateParts): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) && year >= 1 && year <= 3000 && month >= 1 && month <= 12 && day >= 1 && day <= jalaliMonthLength(year, month);
}

export function jalaliToGregorian(date: DateParts): DateParts {
  if (!isValidJalaliDate(date)) throw new RangeError(`Invalid Solar Hijri date ${date.year}/${date.month}/${date.day}`);
  return dayToGregorian(jalaliToDay(date.year, date.month, date.day));
}

export function gregorianToJalali(date: DateParts): DateParts {
  return dayToJalali(gregorianToDay(date.year, date.month, date.day));
}

/** "YYYY-MM-DD", the stored form of a date. */
export function isoDate({ year, month, day }: DateParts): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Whether `value` is an IANA time zone this runtime knows (e.g. "Asia/Tehran"). */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const defaultTimeZone = "Asia/Tehran";
