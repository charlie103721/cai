/**
 * Reads .env.prod and pushes all non-empty values to Cloudflare as secrets.
 * Usage: bun scripts/push-secrets.ts
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";

const env = readFileSync(".env.prod", "utf8");
const secrets: Record<string, string> = {};

for (const line of env.split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx < 1) continue;
  const value = line.slice(idx + 1);
  if (!value) continue;
  secrets[line.slice(0, idx)] = value;
}

const count = Object.keys(secrets).length;
if (count === 0) {
  console.log("No secrets to push (all values empty).");
  process.exit(0);
}

console.log(`Pushing ${count} secrets: ${Object.keys(secrets).join(", ")}`);
execSync("wrangler secret bulk", {
  input: JSON.stringify(secrets),
  stdio: ["pipe", "inherit", "inherit"],
});
