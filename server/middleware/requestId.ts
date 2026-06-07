import type { Context, Next } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

export const requestId = async (c: Context, next: Next): Promise<void> => {
  const id = c.req.header("X-Request-ID") || crypto.randomUUID();
  c.set("requestId", id);
  c.header("X-Request-ID", id);
  await next();
};
