/**
 * The single source of truth for valid user roles. Extending the system
 * is a one-line change: add the new role literal to USER_ROLES and every
 * touchpoint that consumes `UserRole` will type-check against the new set.
 *
 * Roles are stored as plain text in the `user.role` column (not a PG
 * enum, which is rigid to extend). Type safety is enforced at the TS
 * boundary; `isUserRole` guards the DB→app direction so unknown values
 * fall back to `"user"` instead of throwing.
 */
export const USER_ROLES = ["user", "admin", "system"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(v: unknown): v is UserRole {
  return typeof v === "string" && (USER_ROLES as readonly string[]).includes(v);
}
