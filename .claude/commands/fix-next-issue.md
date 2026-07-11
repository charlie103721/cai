---
description: Fix the next eligible GitHub issue (opt-in via the `agent-fix` label), reproduce the bug with a regression test, review the fix locally, auto-fix review findings, then MERGE if clean (closing the issue). If anything still needs a human, it opens a needs-review PR (unmerged) and moves on — it never halts the loop. Orchestrates issue-fixer + code-reviewer subagents. One issue per invocation — run under /loop to burn down a backlog continuously.
argument-hint: "(none — picks the next open issue labelled agent-fix)"
---

<!--
  COMMAND: /fix-next-issue — the synchronous, issue-driven bug-fix loop.
  Why it exists: to burn down a triaged bug backlog the same way /build-next-feature
    burns down a roadmap — pick, fix, review, auto-fix, merge — but sourced from
    GitHub issues instead of a roadmap file, with the fix PR closing the issue.
  How it works: ONE issue per invocation. Picks the first open issue labelled
    `agent-fix` with no in-progress agent:* label and no linked PR/branch, spawns
    issue-fixer to reproduce + fix it (with a regression test) in an isolated
    worktree, spawns code-reviewer for a fresh-eyes pass, auto-fixes up to 2 rounds,
    then MERGES if clean (Closes #N). Anything still needing a human becomes an
    unmerged "needs-review" PR and the issue is labelled agent:needs-human, so the
    loop never halts. State lives on the ISSUE (agent:* labels) + the linked PR.
    Run under /loop to work a backlog continuously.
-->

> Run this at the **top level** (directly, or under `/loop` in the main session) — it spawns subagents, so it must run in the main thread, not inside another subagent.

**Enrollment is opt-in.** Only issues you label **`agent-fix`** are ever touched. Nothing gets a fix attempt unless you asked for it.

**Prime directive: never halt the loop.** Clean fixes are merged automatically (closing the issue). Anything that still needs a human is turned into a **needs-review PR** (opened, *not* merged) and the loop moves on. The loop stops in exactly ONE case — nothing eligible remains. Never merge code that fails the gate or review.

**State labels on the ISSUE** (created up front by **Pass 0** below, then applied as the workflow advances — GitHub does **not** auto-create a label when you add it to an issue, so they must exist first): `agent:fixing` being worked · `agent:in-review` fix under review · `agent:needs-human` a needs-review PR was opened (or a no-change block was escalated), awaiting a person. A merged fix closes the issue and needs no terminal label.

**Open-review-PR** (the failure action, run from the main thread) — **branch on whether the fix actually produced any commits.** Check `git -C <worktree> rev-list --count origin/main..<branch>` (equivalently, `git -C <worktree> diff --quiet origin/main..<branch>`):
- **Commits present** → `git -C <worktree> push -u origin <branch>` → `gh pr create --base main --head <branch> --title "⚠️ fix #<issue> needs review — <short cause>" --body "Closes #<issue>.\n\n<what was attempted, and the exact reason it needs a human: the failing check output or the reviewer's findings>"` → label the issue `agent:needs-human`. Open the PR **ready for review, not a draft** (`AGENT.md`: create PRs ready for review unless a human explicitly asks for a draft).
- **No commits** (issue-fixer returned `BLOCKED` before changing anything — allowed for vague/unreproducible issues) → do **not** run `gh pr create`; it would fail because there are no commits between `main` and the branch. Instead escalate the issue directly: label it `agent:needs-human` and post the blocking reason as a comment — `gh issue comment <issue> --body "🤖 Blocked before any change: <the exact blocking reason>. Needs a human."`. No PR, no pushed branch.

Then `git worktree remove <worktree> --force`. The `agent:needs-human` label (plus the PR **or** the escalation comment) is the durable record — the picker in step 1 skips any `agent:needs-human` issue, and the loop also skips an issue whose PR/branch already exists, so this issue is never re-attempted and never silently stuck.

## Pass 0 — Ensure the state labels exist (idempotent, run once at the top)

GitHub does **not** auto-create a label when you add it to an issue — `gh issue edit --add-label <name>` (and the labels API) **fails** if the label doesn't exist yet. In a repo that only carries the `agent-fix` enrollment label, the very first `agent:fixing` write would error and stall the loop. So, unlike `/review-merged-prs`'s Pass 0 (which relies on `codex:*` labels auto-creating on first use), ensure all three `agent:*` labels exist **before** any step applies them here. This is create-if-missing and safe to re-run every invocation (`--force` updates an existing label instead of failing; if you lack `gh`/the labels API, `gh label create … || true` is an equivalent guard). Reference names/colors:

| label | color | meaning |
|---|---|---|
| `agent:fixing` | `1d76db` | issue being worked |
| `agent:in-review` | `8250df` | fix under review |
| `agent:needs-human` | `d93f0b` | needs-review PR opened (or a no-change block escalated), awaiting a person |

`gh label create agent:fixing --color 1d76db --description "issue being worked" --force`, and likewise for `agent:in-review` and `agent:needs-human`. The state machine keys on label **names**, not colors, so a differently-coloured pre-existing label still works — the point is only that the name exists before it is applied. Only then run the single iteration below.

Do exactly **ONE** iteration. You (main) orchestrate; subagents do the work and never spawn anything.

1. **Pick — oldest first.** `git fetch --prune origin` (prune so deleted remote agent branches don't linger and falsely trip the "branch already exists" check below). List **all** open issues labelled `agent-fix`, sorted **oldest first** — ascending creation date, equivalently lowest issue number. Pass an explicit high `--limit` and an ascending sort so older issues are never hidden behind the default 30-item, newest-first page (e.g. `gh issue list --label agent-fix --state open --limit 200 --search "sort:created-asc"`). Choose the **oldest** issue that (a) has **no** `agent:*` in-progress label and is **not** `agent:needs-human`, and (b) has **no** linked open PR and **no** `agent/issue-<n>-*` branch (`gh pr list --state open --limit 200`, `git branch -r | grep agent/issue-`). This drains the backlog in FIFO order so the oldest bug is always fixed next and nothing starves behind newer arrivals.
   - If none qualify → `STATUS: 🏁 nothing eligible` and stop. Summary: count merged this run + the list of open **needs-review** PRs a human must resolve.

2. **Build the fix.** Label the issue `agent:fixing`. `STATUS: 🔨 #<issue> fixing…` Spawn **issue-fixer** (BUILD: issue number) → `READY — worktree · branch` or `BLOCKED — worktree · branch · reason`.
   - `BLOCKED` → **open-review-PR** (cause = the failing check or "could not reproduce/fix"). `STATUS: 📝 #<issue> needs review — PR #<n> (continuing)`. End iteration.

3. **Review, then fix — before merging** (max **2** fix attempts):
   - Relabel the issue `agent:in-review`. `STATUS: 👀 #<issue> in review` Spawn **code-reviewer** (worktree + a one-line "fix for issue #<n>: <title>") → `VERDICT: CLEAN` or `VERDICT: ISSUES` + list.
   - **CLEAN** → step 4.
   - **ISSUES**, attempts remain → `STATUS: 🔧 #<issue> fixing (attempt k/2)` Spawn **issue-fixer** FIX (worktree + findings). `FIXED` → review again. `BLOCKED` → **open-review-PR** (cause = the findings), `STATUS: 📝 #<issue> needs review — PR #<n> (continuing)`, end iteration.
   - **ISSUES**, no attempts left → **open-review-PR** (cause = the remaining findings), `STATUS: 📝 #<issue> needs review — PR #<n> (continuing)`, end iteration.

4. **Merge (fix is CLEAN).** Guard against a concurrent agent having moved `main`:
   - `git -C <worktree> fetch origin && git -C <worktree> rebase origin/main`. On conflict → `git -C <worktree> rebase --abort`, then **open-review-PR** (cause = `merge conflict with main`), end iteration.
   - Re-gate after rebase — run the **FULL gate**, not just typecheck/tests: `bun run typecheck` · `bun run lint` · `bun run test:run` · `bun run build` in the worktree (the rebase can reintroduce lint failures or a broken bundle the pre-rebase gate never saw). On failure → **open-review-PR** (cause = `broke after rebase`), end iteration.
   - `git -C <worktree> push -u origin <branch>` → `gh pr create --base main --head <branch> --title "fix #<issue>: <short title>" --body "Closes #<issue>.\n\n…reproduced with a regression test · passed local gate · passed independent review…"` → `gh pr merge <n> --merge --delete-branch` → `git worktree remove <worktree> --force`.
   - The merge closes the issue via `Closes #<issue>`. `STATUS: ✅ #<issue> fixed & merged (PR #<n>)`. The loop continues to the next issue.

Never fix more than one issue per invocation. Both subagents are spawned here, in the main thread — the single allowed level of nesting.

## Status legend

`STATUS:` line at every transition:

⬜ eligible · 🔨 fixing · 👀 in review · 🔧 re-fixing · ✅ fixed & merged · 📝 needs-review PR (opened, awaiting a human) · 🏁 nothing left
