import { HTTPException } from "hono/http-exception";
import type { Context, Next } from "hono";

/**
 * Auth guard middleware for protected routes.
 * Throws 401 if no authenticated user is present on the context.
 */
export const authGuard = (c: Context, next: Next) => {
  const user = c.get("user");
  if (!user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return next();
};
