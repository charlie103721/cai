import type { Context, Next } from "hono";
import {
  verifyJWT,
  getJwtSecret,
  getAuthCookie,
  clearAuthCookie,
  type JWTPayload,
} from "../lib/auth";

declare module "hono" {
  interface ContextVariableMap {
    user: JWTPayload | null;
  }
}

/**
 * Non-blocking JWT middleware.
 * Sets `c.var.user` to the decoded payload if a valid token is present
 * (from httpOnly cookie or Authorization header), or `null` otherwise.
 * Does NOT return 401 — that's left to the authGuard middleware.
 */
export const jwtAuth = async (c: Context, next: Next) => {
  const secret = getJwtSecret(c as Context<HonoEnv>);

  // 1. Try httpOnly cookie first (browser sessions)
  const cookieToken = getAuthCookie(c);
  if (cookieToken) {
    const payload = await verifyJWT(cookieToken, secret);
    if (payload) {
      c.set("user", payload);
      await next();
      return;
    }
    // Cookie invalid — clear it and fall through to header check
    clearAuthCookie(c as Context<HonoEnv>);
  }

  // 2. Fall back to Authorization header (API clients, mobile apps)
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, secret);
    c.set("user", payload);
    await next();
    return;
  }

  c.set("user", null);
  await next();
};
