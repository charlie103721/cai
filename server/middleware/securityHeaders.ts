import type { Context, Next } from "hono";

const HSTS_MAX_AGE = 31_536_000; // 1 year in seconds

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": `max-age=${HSTS_MAX_AGE}; includeSubDomains`,
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
} as const;

export const securityHeaders = async (
  c: Context,
  next: Next,
): Promise<void> => {
  await next();

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(name, value);
  }
};
