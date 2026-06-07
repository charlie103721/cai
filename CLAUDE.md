# Project Rules

See [AGENT.md](./AGENT.md) for coding conventions, UI rules, database patterns, and infrastructure setup.

## Quick Reference
- **Package manager**: bun (never npm)
- **Deploy**: `bun run deploy`
- **Dev**: `bun run local`
- **DB migrate**: `bun run db:migrate` (local), `bun run db:migrate:prod` (production)
- **Add shadcn component**: `bunx shadcn@latest add <component>`
