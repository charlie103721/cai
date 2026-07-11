---
description: Build the next eligible feature from the given roadmap file(s), review it locally, auto-fix issues, then MERGE if clean. If anything still needs a human, it opens a needs-review PR (unmerged) and moves on — it never halts the loop. Orchestrates feature-builder + code-reviewer subagents. One feature per invocation — run under /loop to work a roadmap continuously.
argument-hint: "[roadmap files, space-separated; default features-1.md]"
---

<!--
  COMMAND: /build-next-feature — the synchronous, pre-merge feature-building loop.
  Why it exists: to drive a roadmap to completion one feature at a time, behind an
    independent review gate, without a human babysitting each step.
  How it works: ONE feature per invocation. Picks the first eligible ⬜ feature
    (deps met on main, no open PR/branch), spawns feature-builder to build it in an
    isolated worktree, spawns code-reviewer for a fresh-eyes pass, auto-fixes up to
    2 rounds, then MERGES if clean. Anything still needing a human becomes an
    unmerged "needs-review" PR so the loop never halts. Run under /loop to work a
    whole roadmap. Contrast /review-merged-prs, which reviews AFTER merge.
-->

Roadmap files, in priority order: **$ARGUMENTS**
(If that is empty, use `features-1.md`.)

> Run this at the **top level** (directly, or under `/loop` in the main session) — it spawns subagents, so it must run in the main thread, not inside another subagent.

**Prime directive: never halt the loop.** Clean work is merged automatically. Anything that still needs a human is turned into a **needs-review PR** (opened, *not* merged) and the loop moves on. The loop stops in exactly ONE case — nothing eligible remains. Never merge code that fails the gate or review.

**Open-review-PR** (the failure action, run from the main thread): `git -C <worktree> push -u origin <branch>` → `gh pr create --base main --head <branch> --title "⚠️ <id> needs review — <short cause>" --body "<what was built, and the exact reason it needs a human: the failing check output or the reviewer's findings>"` (ready for review, **not** a draft — `AGENT.md`: create PRs ready for review unless a human explicitly asks for a draft) → `git worktree remove <worktree> --force`. The open PR is the durable record — the loop skips this feature on later ticks because a PR/branch already exists for it.

Do exactly **ONE** iteration. You (main) orchestrate; subagents do the work and never spawn anything.

1. **Pick.** `git fetch --prune origin` (prune so deleted remote agent branches don't linger and falsely trip the "branch already exists" check below), then fast-forward your local `main` to the freshly-fetched state — `git checkout main && git merge --ff-only origin/main` — so the roadmap you scan reflects the latest **merged** state, not a stale pre-merge copy. Scan the roadmap files in order; choose the first `⬜` feature that (a) has **no** open PR and **no** `agent/<slug>` branch already (`gh pr list --state open --limit 200`, `git branch -r | grep agent/`) — pass an explicit high `--limit` so an existing needs-review PR isn't hidden behind the default 30-item page — and (b) has all dependencies `✅` on `main`.
   - If none qualify → `STATUS: 🏁 nothing eligible` and stop. Summary: count merged this run + the list of open **needs-review** PRs (these are what a human must resolve; their dependents stay unbuilt until then).

2. **Build.** `STATUS: 🔨 <id> building…` Spawn **feature-builder** (BUILD: feature id + roadmap file) → `READY — worktree · branch` or `BLOCKED — worktree · branch · reason`.
   - `BLOCKED` → **open-review-PR** (cause = the failing check). `STATUS: 📝 <id> needs review — PR #<n> (continuing)`. End iteration.

3. **Review, then fix — before merging** (max **2** fix attempts):
   - `STATUS: 👀 <id> in review` Spawn **code-reviewer** (worktree + id) → `VERDICT: CLEAN` or `VERDICT: ISSUES` + list.
   - **CLEAN** → step 4.
   - **ISSUES**, attempts remain → `STATUS: 🔧 <id> fixing (attempt k/2)` Spawn **feature-builder** FIX (worktree + findings). `FIXED` → review again. `BLOCKED` → **open-review-PR** (cause = the findings), `STATUS: 📝 <id> needs review — PR #<n> (continuing)`, end iteration.
   - **ISSUES**, no attempts left → **open-review-PR** (cause = the remaining findings), `STATUS: 📝 <id> needs review — PR #<n> (continuing)`, end iteration.

4. **Merge (code is CLEAN).** Guard against the concurrent Codex agent having moved `main`:
   - `git -C <worktree> fetch origin && git -C <worktree> rebase origin/main`. On conflict → `STATUS: 🔧 <id> resolving merge conflict` Spawn **feature-builder** RESOLVE (worktree + the conflicting files from `git -C <worktree> status`): resolve every conflict in favor of preserving BOTH mainline changes and the feature's intent, then `git -C <worktree> add -A && git -C <worktree> rebase --continue` until the rebase completes. If the builder returns `BLOCKED` (conflict too entangled to resolve safely) → `git -C <worktree> rebase --abort`, then **open-review-PR** (cause = `merge conflict with main`), end iteration.
   - Re-gate after rebase — run the **FULL gate**, not just typecheck/tests: `bun run typecheck` · `bun run lint` · `bun run test:run` · `bun run build` in the worktree (the rebase can reintroduce lint failures or a broken bundle the pre-rebase gate never saw). On failure → **open-review-PR** (cause = `broke after rebase`), end iteration.
   - If conflicts were resolved, re-review once: spawn **code-reviewer** on the rebased worktree. `ISSUES` → **open-review-PR** (cause = the findings after conflict resolution), end iteration. `CLEAN` → continue.
   - `git -C <worktree> push -u origin <branch>` → `gh pr create --base main --head <branch> --title "…" --body "…built · passed local gate · passed independent review…"` → `gh pr merge <n> --merge --delete-branch` → `git worktree remove <worktree> --force`.
   - `STATUS: ✅ <id> merged (PR #<n>)`. The loop continues to the next feature — the next iteration's **Pick** step fast-forwards local `main` first, so the merged roadmap state is what gets scanned.

Never build more than one feature per invocation. Both subagents are spawned here, in the main thread — the single allowed level of nesting.

## Status legend

`STATUS:` line at every transition:

⬜ todo · 🔨 building · 👀 in review · 🔧 fixing · ✅ merged · 📝 needs-review PR (opened, awaiting a human) · 🏁 nothing left
