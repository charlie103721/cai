import type { Context, Next } from "hono";
import logger from "../util/logger";

export const requestLogger = async (
  c: Context,
  next: Next
): Promise<void> => {
  const start = Date.now();
  await next();
  logger.info("request", {
    requestId: c.get("requestId"),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration: Date.now() - start,
  });
};
