import { describe, expect, it } from "vitest";
import { can, propertyActions, propertyRoles, rolePermissions, type PropertyAction } from "../src/permissions.js";

describe("permissions", () => {
  it("has exactly the owner, admin and member roles", () => {
    expect(propertyRoles).toEqual(["owner", "admin", "member"]);
  });

  const table: Record<PropertyAction, [owner: boolean, admin: boolean, member: boolean]> = {
    "property.view": [true, true, true],
    "device.control": [true, true, true],
    "property.edit": [true, true, false],
    "room.edit": [true, true, false],
    "device.edit": [true, true, false],
    "property.delete": [true, false, false],
  };

  it.each(propertyActions)("%s follows the agreed table", (action) => {
    const [owner, admin, member] = table[action];
    expect([can("owner", action), can("admin", action), can("member", action)]).toEqual([owner, admin, member]);
  });

  it("grants nothing to removed or unknown roles", () => {
    for (const role of ["guest", "viewer", "", "OWNER", null, undefined]) {
      for (const action of propertyActions) expect(can(role as never, action)).toBe(false);
    }
  });

  it("only lists known actions", () => {
    for (const actions of Object.values(rolePermissions)) {
      for (const action of actions) expect(propertyActions).toContain(action);
    }
  });
});
