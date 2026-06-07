import { eq } from "drizzle-orm";
import type { DB } from "../../db";
import { user } from "../../db/schema";
import { isUserRole, type UserRole } from "./roles";

/**
 * Fetch a user's current role from the database. This is the canonical
 * role lookup for non-HTTP contexts (background workers, scripts, queue
 * enqueue paths). HTTP request handlers should read role from the JWT
 * claim via `c.get("user").role` — the `requireRole` middleware does
 * this for route gating.
 *
 * Also used inside `POST /api/auth/refresh` to pull a fresh role into
 * the new access token, bypassing better-auth's session cache so role
 * changes propagate within the access-token lifetime.
 *
 * Throws if the user does not exist — the caller should never be
 * dereferencing a dangling userId. Returns "user" as a defensive
 * fallback if the stored value is somehow not in the USER_ROLES union
 * (e.g. a rogue manual DB write); this fails closed toward minimal
 * privileges rather than granting unexpected access.
 */
export async function getUserRole(
  db: DB,
  userId: string,
): Promise<UserRole> {
  const [row] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) throw new Error(`user not found: ${userId}`);
  return isUserRole(row.role) ? row.role : "user";
}
