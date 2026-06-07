import type { Hono, Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTPException } from "hono/http-exception";
import { fail } from "../util/response";
import logger from "../util/logger";

export const setupErrorHandler = <E extends Env>(app: Hono<E>) => {
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const status = err.status as ContentfulStatusCode;
      const message = err.message || `Request failed with status ${status}`;
      return fail(c, "HTTP_ERROR", message, status);
    }

    const error = err as Error;
    logger.error("unhandled error", {
      requestId: c.get("requestId") || "unknown",
      error: error.message,
      stack: error.stack,
    });
    return fail(c, "INTERNAL_ERROR", "Internal Server Error", 500);
  });
};
