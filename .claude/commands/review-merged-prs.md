---
description: Post-merge remediation loop. Takes recently-MERGED PRs, triggers a Codex review on each, waits (async, via send_later), then fixes the findings on a fresh branch and opens a NEW fix PR. State is tracked entirely via codex:* labels on the source PR, so it survives container cycling. Orchestrates the codex-fixer subagent. Run under /loop, or let its own send_later wakeups drive it.
argument-hint: "[lookback window for merged PRs, e.g. 3d or 10; default 3d]"
---

<!--
  COMMAND: /review-merged-prs — the post-merge Codex remediation engine.
  Why it exists: to catch issues in code that already landed on main by running a
    Codex review AFTER merge and fixing what it finds — the complement to
    /build-next-feature's pre-merge review gate.
  How it works: a label-driven state machine. Each run does three passes —
    reconcile in-flight reviews (A), fix reviewed PRs via the codex-fixer agent
    into NEW stacked PRs (B), and sweep newly-merged PRs to trigger up to K=2
    @codex reviews (C). All state lives in codex:* labels on the SOURCE PR, so it
    survives container cycling; async waits are handled by send_later. Bounded by
    a rate-limit circuit breaker and a 3-attempt stall cap (→ codex:needs-human).
    Self-terminates when the backlog drains; wrap in /review-loop for a day-long
    watcher that also picks up future merges.
-->

Lookback window for merged PRs: **$ARGUMENTS** (if empty, `3d` — PRs merged in the last 3 days).

> Run this at the **top level** (directly, under `/loop`, or when a `send_later` wakeup re-invokes it) — it spawns a subagent, so it must run in the main thread, not inside another subagent.

**What this does:** for each recently-merged PR, comment `@codex review`, wait for Codex to finish (asynchronously — never block a whole invocation on it), then hand the findings to the **codex-fixer** subagent, which fixes them on a fresh branch off `origin/main` and opens a **new** PR. Every bit of state lives as a `codex:*` label on the **source** PR — that is the durable ledger. A `send_later` wakeup re-derives all its work by scanning labels; it never trusts in-memory state.

**Prime directive: never provoke the rate limit, never lose a PR.** At most **2** reviews are in flight at once. A throttle is a distinct outcome from silence and never consumes the wait budget. A PR that times out is marked *retryable*, not written off.

## State labels (the ledger, on the SOURCE PR)

`codex:queued` enrolled, not yet triggered · `codex:requested` `@codex review` posted, awaiting Codex · `codex:reviewed` Codex posted findings, ready to fix · `codex:remediated` fix PR opened (terminal, success) · `codex:clean` Codex found nothing (terminal) · `codex:rate-limited` Codex reported a usage limit; backing off · `codex:stalled` timed out with no response — retryable, but only up to the 3-attempt cap (then → `codex:needs-human`) · `codex:needs-human` fixer blocked or unfixable (terminal). The **new fix PR** gets `codex:fix` (and is excluded from the sweep so it is never re-reviewed recursively).

## Constants

`K = 2` max in-flight (`codex:requested`) · wait cadence **2 min** · give-up after **~180 min** with no Codex response → `codex:stalled` · **max 3 review attempts** (2 stalled retries) before escalating to `codex:needs-human` · rate-limit backoff **30 min** · circuit-breaker cooldown **30 min** after the most recent `codex:rate-limited`.

## Pass 0 — Labels (no pre-creation needed)

**Do not pre-create the labels.** Applying a `codex:*` label to a PR **auto-creates** it if it doesn't exist yet — both `gh pr edit <n> --add-label <name>` and the GitHub MCP `issue_write` (`labels: [...]`) create the label on first use. So there is no separate creation step to run and nothing that fails when a label is missing; just apply labels as the passes below dictate and the ledger builds itself.

Auto-created labels get a default color. That's purely cosmetic — the state machine keys on label **names**, not colors, so it works regardless. If you want the labels to render with their intended colors and you have `gh` (or the labels API) available, you may optionally set them once with `gh label create <name> --color <hex> --description "<desc>" --force`; skip this entirely if that tooling isn't available. Reference names/colors:

| label | color | meaning |
|---|---|---|
| `codex:queued` | `cccccc` | enrolled, not yet triggered |
| `codex:requested` | `1d76db` | `@codex review` posted, awaiting Codex |
| `codex:reviewed` | `8250df` | findings posted, ready to fix |
| `codex:remediated` | `0e8a16` | fix PR opened (terminal, success) |
| `codex:clean` | `2da44e` | Codex found nothing (terminal) |
| `codex:rate-limited` | `d4a72c` | usage limit hit; backing off |
| `codex:stalled` | `fbca04` | timed out, no response; retryable |
| `codex:needs-human` | `d93f0b` | blocked / cap reached (terminal) |
| `codex:fix` | `1abc9c` | marks a fix PR (excluded from the sweep) |

Then do the three passes below **in order**, once, and arm the next wakeup. `gh` and the GitHub MCP tools are interchangeable; examples use `gh`.

### Pass A — Reconcile (advance every `codex:requested` PR)

For each open-or-closed PR labelled `codex:requested`, find our most recent `@codex review` comment on it, then look for Codex's response **after** that comment:

- **Codex posted a formal review** (inline comments or summary from the Codex bot — the account that reacted 👀 to our comment, or any bot whose login contains `codex`):
  - review requests changes / has inline findings → relabel **`codex:reviewed`**.
  - review approves / is summary-only / 👍 with no findings → relabel **`codex:clean`** (done).
- **Codex posted a usage/rate-limit message** (e.g. "usage limit reached") → relabel **`codex:rate-limited`**, record the time. Do **not** count this against the wait budget.
- **No response yet:**
  - If a reactions-capable tool is available and there is **no 👀** on our trigger comment after two cadence cycles → Codex never picked it up → treat as throttled: relabel **`codex:rate-limited`**.
  - Else compute elapsed = now − our latest trigger-comment time. If `> 180 min`, **check the round count** = how many `@codex review` comments we've posted on this PR (this is the durable counter — comments persist even if the container cycles). If this is already the **3rd** attempt (2 retries used) → relabel **`codex:needs-human`** (terminal — Codex never converged, escalate to a person). Otherwise relabel **`codex:stalled`** (retryable). If still `≤ 180 min`, leave `codex:requested` as-is (a wakeup will re-check).

### Pass B — Fix (drain every `codex:reviewed` PR)

For each PR labelled `codex:reviewed`:

1. `STATUS: 🔧 #<pr> fixing`. Collect Codex's findings verbatim (inline comments + summary).
2. Spawn **codex-fixer** with: the source PR number, its merge commit / base, and the findings. It creates `codex-fix/<pr#>` off `origin/main`, applies real fixes, gates, commits, and reports `READY — worktree · branch` or `BLOCKED — reason`.
   - `BLOCKED` → relabel source **`codex:needs-human`**, `STATUS: 📝 #<pr> needs human — <reason>`. Next PR.
3. `READY` → from the **main thread**: `git -C <worktree> push -u origin codex-fix/<pr#>` → open a NEW PR: `gh pr create --base main --head codex-fix/<pr#> --title "🔧 Codex remediation for #<pr> — <short cause>" --body "Addresses the Codex review on #<pr>.\n\n<the findings, and what was changed>"` → add label `codex:fix` to the new PR → `git worktree remove <worktree> --force`.
4. Relabel source PR **`codex:remediated`**. `STATUS: ✅ #<pr> remediated → fix PR #<n>`.

### Pass C — Sweep (enroll new merges, trigger up to the cap)

1. **Cooldown gate.** If any PR carries `codex:rate-limited` whose timestamp is within the last **30 min**, skip the rest of Pass C (we're in circuit-breaker cooldown). Also re-arm any `codex:rate-limited` PR whose 30 min has elapsed back to `codex:queued`.
   - **Re-queue stalls.** Relabel every `codex:stalled` PR back to `codex:queued` for another attempt. This is always safe: a PR only reaches `codex:stalled` while still under the retry cap — once the 3rd attempt times out, Pass A sends it to `codex:needs-human` instead, so a re-queued stall can never loop forever.
2. **Enroll — sweep periodically, read the WHOLE window.** List PRs merged within the lookback window that have **no** `codex:*` label (and are **not** themselves `codex:fix` PRs) and label each **`codex:queued`**. Two things matter:
   - **Sweep periodically, NOT every tick.** You do not need to re-enroll on every 3-min reconcile: while a `codex:queued` backlog already exists, a newly-merged PR would just wait in that same queue behind everything else, so re-scanning adds nothing to throughput (the bottleneck is the `K=2` review cadence, not enrollment). The *only* purpose of re-sweeping is to make sure no merge slips out of the lookback window before it's ever enrolled. So sweep **when the queue is empty** (before you'd otherwise go idle/terminal) and **at most once per ~30 min otherwise**; skip the sweep on the intervening ticks. A cheap probe is a negative-label search that returns *only* un-enrolled merges: `merged:>=<window> -label:codex:queued -label:codex:requested … -label:codex:skip -label:codex:fix` — no full re-scan needed.
   - **Read the whole window, not the default page.** When you do sweep, pass an explicit high `--limit` (e.g. `gh pr list --state merged --search "merged:>=<window>" --limit 300`) or fully paginate the search API — `gh pr list` defaults to **30** and a few days can merge far more (e.g. 80+), so an unbounded call silently skips the older merges.
3. **Respect the cap.** Count in-flight = PRs labelled `codex:requested`. While `in-flight < K` (=2) **and** a `codex:queued` PR exists, promote **one**: post `@codex review`, relabel it **`codex:requested`**, `STATUS: 🚀 #<pr> review requested`. Promote at most a couple per invocation to stay gentle.

### Arm the next wakeup

> Skip this whole section when a scheduler (e.g. `/review-loop`) invoked you and owns the schedule — it decides the next tick and the stop condition instead. Run it only when this command drives itself.

If **any** PR is left in a non-terminal state (`codex:queued`, `codex:requested`, `codex:rate-limited`), schedule the next check with `send_later`:

- normal waiting (`codex:requested` present) → **+2 min**.
- only backing off (all non-terminal PRs are `codex:rate-limited` / cooldown) → **+30 min**.
- message: re-invoke this command, e.g. `Run /review-merged-prs <window> — codex review wakeup`.

**Terminal condition — stop cleanly.** If nothing non-terminal remains (every PR in the window is `codex:remediated` / `codex:clean` / `codex:needs-human`, and the sweep found no new un-labelled merges to enroll), the backlog is drained:

- Print `STATUS: 🏁 nothing in flight` and a one-line tally: `n remediated · n clean · n needs-human · n stalled · n in-flight`.
- **Do not arm a `send_later` wakeup.**
- **If you were invoked under `/loop`, end the loop now** — call `ScheduleWakeup` with `stop: true` (this ends a dynamic `/loop`, i.e. one started with no interval). A fixed-interval loop (`/loop 30m …`) cannot self-terminate — it will keep ticking as cheap no-ops until a human cancels it, so run this command **standalone** or under a **dynamic `/loop`** (no interval) if you want it to stop on its own.

Do not stop merely because everything is *in flight* — only when everything is *terminal*. Being mid-wait (`requested`/`rate-limited`) is not done; arm the wakeup and continue.

## Hard rules

- **Never touch the original PR's branch** — it may be merged/deleted. Fixes always start from a fresh branch off `origin/main`.
- Never comment `@codex` in reply to a comment Codex itself wrote (that spawns an unrelated Codex task). Only comment `@codex review` as a top-level PR comment.
- Never exceed `K=2` in-flight reviews; always honor the cooldown.
- A throttle never consumes the wait budget; a timeout is `codex:stalled` (retryable), not `codex:needs-human`.
- One `codex-fixer` spawn per source PR per pass — it is the single allowed level of nesting.

## Status legend

`STATUS:` at every transition: 🚀 review requested · ⏳ awaiting Codex · 🔧 fixing · ✅ remediated · 🟢 clean · 🐢 rate-limited (backing off) · 💤 stalled (retryable) · 📝 needs human · 🏁 nothing in flight
