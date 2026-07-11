---
description: Idle-timeout scheduler around /fix-next-issue. Drains the agent-fix issue backlog continuously (fixing one issue after another), rechecks every 1 hour when there's nothing eligible, and ENDS the session once there have been no eligible issues for a full day (24h). Finding work resets the idle clock. It delegates ALL fix/review/merge logic to /fix-next-issue; this command owns only the schedule and the idle deadline.
argument-hint: "(none — 1-hour idle recheck, ends after 24h with no issues)"
---

<!--
  COMMAND: /fix-loop — idle-timeout scheduler around /fix-next-issue.
  Why it exists: /fix-next-issue fixes one issue and stops; this keeps it draining
    the agent-fix backlog, picks up newly-labelled issues, and ends the session on
    its own once the queue has stayed empty for a full day — no manual cancel.
  How it works: a thin scheduler that reuses the engine (/fix-next-issue) and owns
    only timing. Because fixing is synchronous (no external waits), each tick DRAINS
    — it runs /fix-next-issue back-to-back until the backlog is empty. Then it sleeps
    1 hour and rechecks for new agent-fix issues. It does NOT run on a fixed window:
    it stops only after 24h of CONTINUOUS idle (no eligible issues). Any issue found
    resets that idle clock. The idle-start time is threaded through wakeup messages
    (idle-since=<ISO>) so it survives container cycling.
-->

> Run at the **top level** (directly, or let its own `send_later` ticks drive it). It reuses `/fix-next-issue` as its engine — do not duplicate that logic here.

**Purpose:** keep `/fix-next-issue` burning down the `agent-fix` backlog for as long as issues keep arriving, then stop by itself once it's been quiet for a day. This command is a thin **scheduler**: over the engine it adds continuous draining, a 1-hour idle recheck, and a 24-hour idle stop.

**Stop rule (idle timeout, not a fixed window):** the loop runs indefinitely while there is work. It ends only when the backlog has been empty for **24 continuous hours**. Every time a tick finds and fixes an issue, the idle clock **resets**.

## Each tick

1. **Read the idle clock.** Look for `idle-since=<ISO8601>` in the message that invoked this tick.
   - Present → that is when the current idle stretch began.
   - Absent → we are not currently idle (first tick, or the previous tick did work).

2. **Drain the backlog.** Loop: run **one pass of `/fix-next-issue`**.
   - It fixed & merged an issue, or opened a needs-review PR (i.e. it found eligible work) → `STATUS: 🔁 draining…` and loop again immediately (no wait — fixing is synchronous). **Mark that work happened this tick.**
   - It reported `🏁 nothing eligible` (backlog empty) → break out of the drain loop.

3. **Decide the next step.**
   - **Work happened this tick** → the idle clock is reset. Arm the next tick soon with `send_later` (**+1 min**) to keep draining any stragglers, re-invoking THIS command **without** an `idle-since` (message: `Run /fix-loop — fix loop tick`). `STATUS: 🔁 more may remain — continuing`.
   - **No work this tick (backlog empty):**
     - Determine `idle-since`: if it was present in the invoking message, keep it; otherwise set `idle-since = now` (run `date -u +%Y-%m-%dT%H:%M:%SZ`) — this idle stretch just began.
     - Compute `idle-elapsed = now − idle-since`.
       - **`idle-elapsed ≥ 24h`** → the queue has been empty for a full day. Print the final tally (`n fixed & merged · n needs-review PRs opened`), then `STATUS: 🛑 24h with no issues — ending session`. **STOP:** do not arm any wakeup, and call `ScheduleWakeup` with `stop: true` to end any dynamic loop. The session then goes idle and is reclaimed.
       - **Otherwise** → arm a **+1 hour** recheck with `send_later`, re-invoking THIS command with the idle clock threaded (message: `Run /fix-loop — idle-since=<ISO> — fix loop recheck`). `STATUS: 😴 backlog empty (idle <idle-elapsed>) — rechecking in 1h`.

## Notes

- Everything about picking, fixing, reviewing, and merging issues is **inherited from `/fix-next-issue`** — see that command. This one changes only **how often** it rechecks and **when** it ends.
- Only issues labelled **`agent-fix`** are ever touched; keep labelling issues while it runs and each drain pass picks them up.
- "Empty" means only `agent:needs-human` / unlabelled issues remain — the needs-review PRs are the human queue; they do not reset the idle clock or keep the loop alive.
- There is **no fixed maximum runtime** — as long as new `agent-fix` issues keep appearing at least once every 24h, the loop keeps going. It ends only after a full day of silence. To stop it sooner, cancel the pending `send_later` wakeup.

## Status legend

🔁 draining (fixing back-to-back) · 😴 backlog empty — 1-hour recheck · 🛑 24h idle — session ended.
