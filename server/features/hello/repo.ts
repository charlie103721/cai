import type { DB } from "../../db";

export async function findGreeting(_db: DB, name: string) {
  // Example: replace with a real Drizzle query when backed by a table
  return { name, greeting: `Hello from ${name}!`, timestamp: Date.now() };
}
