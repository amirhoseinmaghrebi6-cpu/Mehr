/**
 * The operator's panel: /v1/admin/*, only for the phone numbers in the API's PLATFORM_ADMIN_PHONES
 * (everyone else gets 403). It shows counts, people and boards, never what is inside a home.
 */
import { z } from "zod";

/** GET /v1/admin/overview */
export interface AdminOverview {
  users: number;
  blockedUsers: number;
  homes: number;
  boards: number;
  boardsOnline: number;
  /** Commands sent in the last 24 hours (older ones are deleted). */
  commandsToday: number;
  services: {
    database: boolean;
    /** The API is connected to the boards' MQTT broker. */
    broker: boolean;
    /** SMS codes can be sent (key, sender and code pattern set). */
    sms: boolean;
    /** Kratos's admin API is configured, so users can be blocked and deleted. */
    accounts: boolean;
  };
}

export interface AdminUser {
  id: string;
  name: string;
  phone: string | null;
  createdAt: string;
  blocked: boolean;
  homesOwned: number;
  homesJoined: number;
  /** Another operator, or the caller: cannot be blocked or deleted here. */
  platformAdmin: boolean;
}

/** GET /v1/admin/users?search=&offset= (50 a page, newest first) */
export interface AdminUserListResponse {
  users: AdminUser[];
  total: number;
}

export interface AdminBoard {
  id: string;
  hardwareUid: string;
  model: string;
  firmwareVersion: string | null;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  ownerName: string;
  ownerPhone: string | null;
}

/** GET /v1/admin/boards?offset= (50 a page, online first) */
export interface AdminBoardListResponse {
  boards: AdminBoard[];
  total: number;
}

export const ADMIN_PAGE_SIZE = 50;

/** PATCH /v1/admin/users/:userId */
export const adminUpdateUserRequest = z.object({ blocked: z.boolean() }).strict();
export type AdminUpdateUserRequest = z.infer<typeof adminUpdateUserRequest>;
