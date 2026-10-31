/**
 * Changing the account's mobile number: POST /v1/me/phone sends a code to the new number, then
 * POST /v1/me/phone/verify with that code moves sign-in to it. Both need a recent sign-in
 * (otherwise 403 reauth_required).
 */
import { z } from "zod";

/** How long ago the user must have signed in to change their number. */
export const PHONE_CHANGE_RECENT_SIGN_IN_MINUTES = 15;

/** POST /v1/me/phone: the new number, in any usual form. */
export const changePhoneRequest = z.object({ phone: z.string().trim().min(1).max(32) }).strict();
export type ChangePhoneRequest = z.infer<typeof changePhoneRequest>;

/** POST /v1/me/phone/verify: the 6-digit code from the SMS. */
export const confirmPhoneRequest = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export type ConfirmPhoneRequest = z.infer<typeof confirmPhoneRequest>;

/** Both answer with the number (E.164): where the code went, then the account's new number. */
export interface PhoneChangeResponse {
  phone: string;
}
