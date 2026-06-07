/**
 * Reads .env.prod and pushes required secrets to GitHub repo.
 * Skips Cloudflare secrets if the repo is in an org (org-level secrets cover those).
 * Usage: bun scripts/push-github-secrets.ts
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";

// Secrets to push from .env.prod
const GITHUB_SECRET_KEYS = ["DATABASE_URL", "BETTER_AUTH_SECRET"];

const env = readFileSync(".env.prod", "utf8");
const parsed: Record<string, string> = {};

for (const line of env.split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx < 1) continue;
  const value = line.slice(idx + 1);
  if (!value) continue;
  parsed[line.slice(0, idx)] = value;
}

// Detect if repo is in an org (org-level secrets provide CF credentials)
function isOrgRepo(): boolean {
  try {
    const info = execSync("gh repo view --json owner --jq '.owner.type'", {
      encoding: "utf8",
    }).trim();
    return info === "Organization";
  } catch {
    return false;
  }
}

const inOrg = isOrgRepo();

// Collect secrets to push
const secrets: Record<string, string> = {};
const missing: string[] = [];

for (const key of GITHUB_SECRET_KEYS) {
  if (parsed[key]) {
    secrets[key] = parsed[key];
  } else {
    missing.push(key);
  }
}

if (missing.length > 0) {
  console.warn(`Warning: missing values in .env.prod: ${missing.join(", ")}`);
}

if (inOrg) {
  console.log(
    "Repo is in an org — skipping CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_DEPLOY_API_TOKEN (provided by org secrets)",
  );
} else {
  // Auto-detect Cloudflare Account ID for personal repos
  try {
    const output = execSync("bunx wrangler whoami 2>/dev/null", {
      encoding: "utf8",
    });
    const match = output.match(/│\s+\S.*?\s+│\s+([a-f0-9]{32})\s+│/);
    if (match) {
      secrets["CLOUDFLARE_ACCOUNT_ID"] = match[1];
    }
  } catch {
    console.warn(
      "Warning: could not detect CLOUDFLARE_ACCOUNT_ID (run `bunx wrangler login` first)",
    );
  }
}

const count = Object.keys(secrets).length;
if (count === 0) {
  console.log("No secrets to push.");
  process.exit(0);
}

console.log(
  `Pushing ${count} GitHub secrets: ${Object.keys(secrets).join(", ")}`,
);

for (const [key, value] of Object.entries(secrets)) {
  try {
    execSync(`gh secret set ${key}`, {
      input: value,
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`  ✓ ${key}`);
  } catch {
    console.error(`  ✗ ${key} — failed (is gh CLI authenticated?)`);
  }
}

if (!inOrg) {
  console.log(
    "\nRemember to also set CLOUDFLARE_DEPLOY_API_TOKEN manually:",
  );
  console.log("  gh secret set CLOUDFLARE_DEPLOY_API_TOKEN");
}
