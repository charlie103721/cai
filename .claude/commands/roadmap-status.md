---
description: Show the status of every feature across the given roadmap file(s) — done, in review, blocked, or todo — by cross-referencing the roadmap with open PRs and branches. Read-only.
argument-hint: "[roadmap files; default FEATURES.md]"
---

<!--
  COMMAND: /roadmap-status — read-only roadmap dashboard.
  Why it exists: to see the state of every feature at a glance without touching
    anything, by cross-referencing the roadmap against live PRs and branches.
  How it works: reads the roadmap file(s), lists open PRs and agent/* branches,
    and classifies each feature (merged / needs-review / in-review / ready /
    waiting-on-dep). Prints a compact table + one-line tally. Never modifies,
    commits, or merges — safe to run any time.
-->

Roadmap files: **$ARGUMENTS** (if empty, `FEATURES.md`). **Read-only** — do not modify, commit, or merge anything.

Report the current state of the roadmap:

1. Read the roadmap file(s): list each feature with its id, `⬜`/`🔨`/`✅` mark, and the dependency chain.
2. Find in-flight work: `gh pr list --state open --json number,title,headRefName,isDraft,mergeable` and `git branch -r | grep agent/`. Match to features by id / `agent/<slug>`. A ⚠️/draft PR titled "needs review" is one the loop opened after failing to auto-clear.
3. Classify each feature:
   - `✅ merged` — checkbox is `✅` on `main`.
   - `📝 needs review` — `⬜` but an open (draft) needs-review PR exists; show the PR # and its cause (the loop set it aside for a human).
   - `👀 in review` — `⬜` with an open branch/PR that isn't a needs-review one (work in flight).
   - `⬜ ready` — `⬜`, no PR/branch, dependencies met.
   - `⬜ waiting` — `⬜` but a dependency is unmet or itself needs-review; show `waiting on <dep>`.
4. Print a compact table — `feature | status | PR | note` — followed by a one-line tally, e.g. `6 ✅ · 1 📝 · 2 ⬜`.

Legend: ⬜ todo · 🔨 building · 👀 in review · ✅ merged · 📝 needs-review PR.
