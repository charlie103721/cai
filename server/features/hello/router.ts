import { Hono } from "hono";
import { ok } from "../../util/response";
import { getGreeting } from "./service";

const helloRoutes = new Hono<HonoEnv>();

helloRoutes.get("/", async (c) => {
  const db = c.get("db");
  const data = await getGreeting(db, c.req.query("name"));
  return ok(c, data);
});

export { helloRoutes };
