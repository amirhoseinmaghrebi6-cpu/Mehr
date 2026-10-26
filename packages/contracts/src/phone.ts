/**
 * Normalizes what people type as a mobile number into E.164, the form Kratos stores.
 *
 * Accepts Persian (۰-۹) and Arabic-Indic (٠-٩) digits, spaces, dashes and brackets, and the
 * usual Iranian forms: 09121234567, 9121234567, 00989121234567, +989121234567. Other countries
 * must be entered with + or 00. Returns null when the result is not a plausible mobile number.
 */
/** Converts Persian (۰-۹) and Arabic-Indic (٠-٩) digits to 0-9. */
export function latinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

export function normalizePhone(input: string): string | null {
  const latin = latinDigits(input).replace(/[\s\-().]/g, "");

  let e164: string;
  if (/^\+\d+$/.test(latin)) e164 = latin;
  else if (/^00\d+$/.test(latin)) e164 = `+${latin.slice(2)}`;
  else if (/^09\d{9}$/.test(latin)) e164 = `+98${latin.slice(1)}`;
  else if (/^9\d{9}$/.test(latin)) e164 = `+98${latin}`;
  else return null;

  if (e164.startsWith("+98")) return /^\+989\d{9}$/.test(e164) ? e164 : null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** "+989121234567" → "0912 ••• 4567", for showing where a code was sent. */
export function maskPhone(e164: string): string {
  const local = e164.startsWith("+98") ? `0${e164.slice(3)}` : e164;
  return local.length > 7 ? `${local.slice(0, 4)} ••• ${local.slice(-4)}` : local;
}
