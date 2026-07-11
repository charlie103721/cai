---
description: Day-long scheduler around /review-merged-prs. Each tick runs that command's review→fix→sweep engine, then sleeps — 30 min between rechecks when there's nothing to review, 2 min while Codex is actively reviewing something — and automatically ENDS after a 24-hour window. It delegates ALL review/fix logic to /review-merged-prs; this command owns only the schedule and the deadline.
argument-hint: "(none — fixed 24h window, 30-min idle recheck)"
---

<!--
  COMMAND: /review-loop — day-long scheduler around /review-merged-prs.
  Why it exists: /review-merged-prs stops once its backlog drains; this keeps it
    watching for NEW merges across a fixed window, then ends the session on its own
    — no manual cancel, unlike a bare `/loop 30m …`.
  How it works: a thin scheduler that reuses the engine (Pass 0/A/B/C of
    /review-merged-prs) and owns only timing. Each tick runs one engine pass, then
    arms the next via send_later — +2 min while Codex is actively reviewing, +30 min
    when idle. A 24h deadline is fixed at the FIRST tick and threaded through wakeup
    messages (stop-at=<ISO>) so it survives restarts; once the window elapses it
    stops scheduling and ends the session.
-->

> Run at the **top level** (directly, or let its own `send_later` ticks drive it). It reuses `/review-merged-prs` as its engine — do not duplicate that logic here.

**Purpose:** keep `/review-merged-prs` running for a day without babysitting, then stop by itself. This command is a thin **scheduler**: it reuses that command's engine (Pass 0 labels + Pass A reconcile + Pass B fix + Pass C sweep) and adds exactly two things — an idle recheck interval and a hard 24-hour stop.

## Each tick

1. **Establish the deadline.** Look for `stop-at=<ISO8601>` in the message that invoked this tick.
   - Present → that is the hard stop.
   - Absent (this is the **first** tick) → run `date -u +%Y-%m-%dT%H:%M:%SZ` for `now`, set `stop-at = now + 24h`. This value is threaded through every wakeup message below, so it survives container cycling — the 24h clock lives in the message, not in memory, and **starts at the first tick** (wakeups never extend it).

2. **Run one pass of the engine.** Execute **Pass 0, A, B, and C of `/review-merged-prs`** exactly as written — **but do NOT run its "Arm the next wakeup / Terminal condition" section; this command owns scheduling.** After the pass, note the state: is any PR non-terminal (`codex:queued` / `codex:requested` / `codex:rate-limited`) — i.e. is there **work in flight**?

3. **Check the deadline.** Run `date -u …` for `now`.
   - **`now ≥ stop-at`** → the 24-hour window is over. Print the final tally (`n remediated · n clean · n needs-human · n stalled`), then `STATUS: 🛑 24h window elapsed — ending session`. **STOP:** do not arm any wakeup, and call `ScheduleWakeup` with `stop: true` to end any dynamic loop. The session then goes idle and is reclaimed. Do not continue past this point — even if PRs are still in flight, the window is the hard cap.

4. **Otherwise, schedule the next tick** with `send_later`, re-invoking THIS command with the deadline threaded:
   - **Work in flight** → **+2 min** (mirror the engine's active cadence). If the only in-flight PRs are `codex:rate-limited`, use **+30 min** instead, honoring the backoff.
   - **Nothing to review** (fully drained — every PR terminal and the sweep enrolled no new merges) → **+30 min** idle recheck for newly-merged PRs.
   - Wakeup message: `Run /review-loop — stop-at=<ISO> — review loop tick`.

## Notes

- Everything about triggering `@codex review`, waiting, fixing findings, and opening fix PRs is **inherited from `/review-merged-prs`** — see that command. This one changes only **when** the engine runs and **when** it ends.
- Unlike a bare `/loop 30m /review-merged-prs` (which never self-stops), this ends itself at the 24h mark — no manual cancel needed.
- To stop early, cancel the pending `send_later` wakeup.

## Status legend

🔁 tick · ⏳ work in flight (+3m) · 🐢 backing off (+30m) · 😴 idle, nothing to review (+30m) · 🛑 24h elapsed — session ended.
