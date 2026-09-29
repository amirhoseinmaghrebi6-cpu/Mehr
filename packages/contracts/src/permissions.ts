/**
 * Who may do what in a home. Plain data, so the API, the web app and (later) the hub enforce the
 * same rules. The database enforces the same boundaries again with RLS.
 */

/** Roles a user can hold in one home (property). There are no guest or viewer roles. */
export const propertyRoles = ["owner", "admin", "member"] as const;
export type PropertyRole = (typeof propertyRoles)[number];

export const propertyActions = [
  /** See the home, its rooms, devices and their reported state. */
  "property.view",
  /** Send commands to devices. */
  "device.control",
  /** Change the home's name, type, address and photo. */
  "property.edit",
  /** Add, rename, reorder and delete rooms. */
  "room.edit",
  /** Rename a device or move it to another room. Pin assignments are never editable. */
  "device.edit",
  /** Delete the home with everything in it. */
  "property.delete",
] as const;
export type PropertyAction = (typeof propertyActions)[number];

export const rolePermissions: Readonly<Record<PropertyRole, readonly PropertyAction[]>> = {
  owner: ["property.view", "device.control", "property.edit", "room.edit", "device.edit", "property.delete"],
  admin: ["property.view", "device.control", "property.edit", "room.edit", "device.edit"],
  member: ["property.view", "device.control"],
};

export function isPropertyRole(value: unknown): value is PropertyRole {
  return typeof value === "string" && (propertyRoles as readonly string[]).includes(value);
}

/** Whether `role` may perform `action`. Unknown roles may do nothing. */
export function can(role: PropertyRole | null | undefined, action: PropertyAction): boolean {
  return isPropertyRole(role) && rolePermissions[role].includes(action);
}
