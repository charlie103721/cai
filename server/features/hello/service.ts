import type { DB } from "../../db";
import { findGreeting } from "./repo";

const DEFAULT_NAME = "Hono";

export async function getGreeting(db: DB, name?: string) {
  return findGreeting(db, name || DEFAULT_NAME);
}
