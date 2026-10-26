/**
 * Members of a home and invitations to it. People are invited by mobile number; the invited person
 * sees the invitation once signed in and accepts or declines it. An invitation stays until then,
 * or until it is cancelled.
 */
import { z } from "zod";
import type { PropertyRole } from "./permissions.js";
import { normalizePhone } from "./phone.js";

/** Roles that can be given by invitation or by a role change; a home has its owner from the start. */
export const invitableRoles = ["admin", "member"] as const;
export type InvitableRole = (typeof invitableRoles)[number];

/** A mobile number as people type it, stored in E.164 ("+989121234567"). */
const phone = z
  .string()
  .max(32)
  .transform((value, context) => normalizePhone(value) ?? (context.addIssue({ code: "custom", message: "not a mobile number" }), z.NEVER));

export const createInvitationRequest = z.strictObject({ phone, role: z.enum(invitableRoles) });
export type CreateInvitationRequest = z.input<typeof createInvitationRequest>;

export const updateMemberRequest = z.strictObject({ role: z.enum(invitableRoles) });
export type UpdateMemberRequest = z.input<typeof updateMemberRequest>;

export type HomeMember = {
  userId: string;
  name: string;
  /** E.164; null for an account without one. */
  phone: string | null;
  role: PropertyRole;
  /** The signed-in user. */
  you: boolean;
};

export type HomeInvitation = { id: string; phone: string; role: InvitableRole; createdAt: string };

/** Owners and admins see everyone and the open invitations; a member sees only themself. */
export type MemberListResponse = { members: HomeMember[]; invitations: HomeInvitation[] };

/** An invitation to the signed-in user. */
export type MyInvitation = { id: string; propertyName: string; invitedBy: string; role: InvitableRole; createdAt: string };
export type MyInvitationListResponse = { invitations: MyInvitation[] };

/** At most this many open invitations per home. */
export const MAX_INVITATIONS_PER_HOME = 50;
