---
description: Idle-timeout scheduler around /build-next-feature. Builds the roadmap continuously (one feature after another, merging clean work), rechecks every 1 hour when nothing is eligible, and ENDS the session once nothing has been eligible for a full day (24h). Finding buildable work resets the idle clock. It delegates ALL build/review/merge logic to /build-next-feature; this command owns only the schedule and the idle deadline.
argument-hint: "[roadmap files, space-separated; default features-1.md]"
---

<!--
  COMMAND: /build-loop — idle-timeout scheduler around /build-next-feature.
  Why it exists: so you can start a continuous roadmap build with ONE command
    instead of typing `/loop /build-next-feature`. /build-next-feature builds one
    feature and stops; this keeps it going, picks up features that become eligible
    when a human clears a blocking needs-review PR, and ends on its own after a full
    day with nothing to build.
  How it works: a thin scheduler that reuses the engine (/build-next-feature) and
    owns only timing. Because building is synchronous (no external waits), each tick
    DRAINS — it runs /build-next-feature back-to-back until nothing is eligible. Then
    it sleeps 1 hour and rechecks. It does NOT run on a fixed window: it stops only
    after 24h of CONTINUOUS idle (nothing eligible). Any feature built resets that
    idle clock. The idle-start time and the roadmap files are threaded through wakeup
    messages (idle-since=<ISO>) so they survive container cycling.
-->

> Run at the **top level** (directly, or let its own `send_later` ticks drive it). It reuses `/build-next-feature` as its engine — do not duplicate that logic here.

Roadmap files, in priority order: **$ARGUMENTS** (if empty, `features-1.md`). Pass these to `/build-next-feature` on every tick and thread them through the wakeup messages below.

**Purpose:** keep `/build-next-feature` working a roadmap for as long as features remain buildable, then stop by itself once it's been idle for a day — without you typing `/loop`.

**Stop rule (idle timeout, not a fixed window):** the loop runs while there is buildable work. It ends only when nothing has been eligible for **24 continuous hours**. Every time a tick builds a feature, the idle clock **resets**. (Features can become eligible again after a human resolves a blocking needs-review PR, which is why it keeps rechecking.)

## Each tick

1. **Read the idle clock.** Look for `idle-since=<ISO8601>` in the message that invoked this tick.
   - Present → that is when the current idle stretch began.
   - Absent → we are not currently idle (first tick, or the previous tick did work).

2. **Drain the roadmap.** Loop: run **one pass of `/build-next-feature <roadmap files>`**.
   - It merged a feature, or opened a needs-review PR (i.e. it found eligible work) → `STATUS: 🔁 building…` and loop again immediately (no wait — building is synchronous). **Mark that work happened this tick.**
   - It reported `🏁 nothing eligible` → break out of the drain loop.

3. **Decide the next step.**
   - **Work happened this tick** → the idle clock is reset. Arm the next tick soon with `send_later` (**+1 min**) to keep going, re-invoking THIS command **without** an `idle-since` (message: `Run /build-loop <roadmap files> — build loop tick`). `STATUS: 🔁 more may remain — continuing`.
   - **No work this tick (nothing eligible):**
     - Determine `idle-since`: if it was present in the invoking message, keep it; otherwise set `idle-since = now` (run `date -u +%Y-%m-%dT%H:%M:%SZ`) — this idle stretch just began.
     - Compute `idle-elapsed = now − idle-since`.
       - **`idle-elapsed ≥ 24h`** → nothing has been buildable for a full day. Print the final tally (`n merged · n needs-review PRs opened`), then `STATUS: 🛑 24h with nothing eligible — ending session`. **STOP:** do not arm any wakeup, and call `ScheduleWakeup` with `stop: true` to end any dynamic loop. The session then goes idle and is reclaimed.
       - **Otherwise** → arm a **+1 hour** recheck with `send_later`, re-invoking THIS command with the idle clock and roadmap files threaded (message: `Run /build-loop <roadmap files> — idle-since=<ISO> — build loop recheck`). `STATUS: 😴 nothing eligible (idle <idle-elapsed>) — rechecking in 1h`.

## Notes

- Everything about picking, building, reviewing, and merging features is **inherited from `/build-next-feature`** — see that command. This one changes only **how often** it rechecks and **when** it ends.
- "Nothing eligible" can be temporary: a feature blocked on a dependency that is itself a needs-review PR becomes buildable once a human merges that PR. The 1-hour recheck is what picks it up — so the needs-review PRs are the human queue that unblocks further progress.
- There is **no fixed maximum runtime** — as long as features keep becoming eligible at least once every 24h, the loop keeps going. It ends only after a full day of nothing to build. To stop it sooner, cancel the pending `send_later` wakeup.

## Status legend

🔁 building (back-to-back) · 😴 nothing eligible — 1-hour recheck · 🛑 24h idle — session ended.
