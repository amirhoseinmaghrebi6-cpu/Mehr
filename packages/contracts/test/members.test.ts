import { describe, expect, it } from "vitest";
import { createInvitationRequest } from "../src/members.js";

describe("invitations", () => {
  it("stores the number in E.164, whatever form it was typed in", () => {
    expect(createInvitationRequest.parse({ phone: "۰۹۱۲ ۱۲۳ ۴۵۶۷", role: "member" })).toEqual({ phone: "+989121234567", role: "member" });
    expect(createInvitationRequest.parse({ phone: "+44 7700 900123", role: "admin" }).phone).toBe("+447700900123");
  });

  it("refuses what is not a mobile number, and the owner role", () => {
    expect(createInvitationRequest.safeParse({ phone: "12345", role: "member" }).success).toBe(false);
    expect(createInvitationRequest.safeParse({ phone: "09121234567", role: "owner" }).success).toBe(false);
  });
});
