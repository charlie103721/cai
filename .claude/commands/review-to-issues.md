---
description: Post-merge Codex review that FILES ISSUES instead of fixing. Triggers a Codex review on each recently-merged PR, waits (async, via send_later), then files ONE GitHub issue per PR (aggregating all its findings) labelled `agent-fix` so `/fix-loop` can pick it up. Never writes code, never opens a fix PR — it only files issues. State is tracked in codex:* labels on the source PR, so it survives container cycling. Run under /loop, or let its own send_later wakeups drive it.
argument-hint: "[lookback-window] (default 3d) — e.g. 7d"
---

<!--
  COMMAND: /review-to-issues — the post-merge Codex triage-to-issues engine.
  Why it exists: the same post-merge Codex review as /review-merged-prs, but the
    remediation path is DIFFERENT. Instead of auto-fixing findings and opening fix
    PRs (Pass B of /review-merged-prs), this command FILES one GitHub issue per
    PR (aggregating all of that PR's findings), labelled `agent-fix`, and stops
    there. A human (or /fix-loop) then fixes the issues on their own schedule. Use
    this when you want the findings triaged into your issue backlog rather than
    fixed immediately.
  How it works: same label-driven state machine as /review-merged-prs. Each run
    does three passes — reconcile in-flight reviews (A), FILE ISSUES for reviewed
    PRs (B), and sweep newly-merged PRs to trigger up to K=2 @codex reviews (C).
    All state lives in codex:* labels on the SOURCE PR; async waits use send_later.
    Bounded by a rate-limit circuit breaker and a 3-attempt stall cap. Filing is
    idempotent (a hidden marker per issue + the codex:filed terminal label), so
    re-runs never double-file. Self-terminates when the backlog drains.
  Pairs with: /fix-loop (or /fix-next-issue) — that command drains the `agent-fix`
    issues this one creates. Run this first, then run /fix-loop.
-->

Lookback window for merged PRs: **$1** (if empty, `3d` — PRs merged in the last 3 days).

> Run this at the **top level** (directly, under `/loop`, or when a `send_later` wakeup re-invokes it). It creates issues via the GitHub API; it does **not** spawn subagents, open PRs, or write code.

**What this does:** for each recently-merged PR, comment `@codex review`, wait for Codex to finish (asynchronously — never block a whole invocation on it), then roll up all of Codex's findings on that PR into **one GitHub issue labelled `agent-fix`** (a checklist of findings) so your `/fix-loop` picks it up. Every bit of PR-level state lives as a `codex:*` label on the **source** PR — that is the durable ledger. A `send_later` wakeup re-derives all its work by scanning labels; it never trusts in-memory state.

**This command is the "file issues" alternative to `/review-merged-prs`.** They share the same `codex:*` ledger and the same Pass A/C engine — the only difference is Pass B (this one files issues; the other opens fix PRs). **Do not run both on the same window at the same time**, or they'll fight over the same `codex:queued`/`codex:reviewed` PRs. Pick one remediation style per backlog.

**Prime directive: never provoke the rate limit, never lose a PR, never double-file.** At most **2** reviews are in flight at once. A throttle is a distinct outcome from silence and never consumes the wait budget. A PR that times out is marked *retryable*, not written off. Filing is idempotent — a PR already turned into an issue is never filed again.

## State labels (the ledger, on the SOURCE PR)

`codex:queued` enrolled, not yet triggered · `codex:requested` `@codex review` posted, awaiting Codex · `codex:reviewed` Codex posted findings, ready to file · `codex:filed` issues filed from the findings (terminal, success) · `codex:clean` Codex found nothing (terminal) · `codex:rate-limited` Codex reported a usage limit; backing off · `codex:stalled` timed out with no response — retryable, but only up to the 3-attempt cap (then → `codex:needs-human`) · `codex:needs-human` blocked or unfixable (terminal).

Each **filed issue** gets `agent-fix` (so `/fix-loop` enrolls it) + `codex-finding` (provenance).

## Constants

`K = 2` max in-flight (`codex:requested`) · wait cadence **2 min** · give-up after **~180 min** with no Codex response → `codex:stalled` · **max 3 review attempts** (2 stalled retries) before escalating to `codex:needs-human` · rate-limit backoff **30 min** · circuit-breaker cooldown **30 min** after the most recent `codex:rate-limited`.

## Pass 0 — Labels (no pre-creation needed)

**Do not pre-create the labels.** Applying a `codex:*` / `agent-fix` / `codex-finding` label to a PR or issue **auto-creates** it if it doesn't exist yet — both `gh` (`--add-label` / `--label`) and the GitHub MCP (`issue_write` with `labels: [...]`) create the label on first use. So there is no separate creation step and nothing that fails when a label is missing; just apply labels as the passes below dictate.

Auto-created labels get a default color. That's purely cosmetic — the state machine keys on label **names**, not colors. If you want the intended colors and you have `gh` (or the labels API) available, you may optionally set them once with `gh label create <name> --color <hex> --description "<desc>" --force`; skip this entirely if that tooling isn't available. Reference names/colors:

| label | color | meaning |
|---|---|---|
| `codex:queued` | `cccccc` | enrolled, not yet triggered |
| `codex:requested` | `1d76db` | `@codex review` posted, awaiting Codex |
| `codex:reviewed` | `8250df` | findings posted, ready to file |
| `codex:filed` | `0e8a16` | issues filed from findings (terminal, success) |
| `codex:clean` | `2da44e` | Codex found nothing (terminal) |
| `codex:rate-limited` | `d4a72c` | usage limit hit; backing off |
| `codex:stalled` | `fbca04` | timed out, no response; retryable |
| `codex:needs-human` | `d93f0b` | blocked / cap reached (terminal) |
| `agent-fix` | `5319e7` | opt-in: /fix-loop will fix this issue |
| `codex-finding` | `1abc9c` | issue was auto-filed from a Codex review |

Then do the three passes below **in order**, once, and arm the next wakeup. `gh` and the GitHub MCP tools are interchangeable; examples use `gh`.

### Pass A — Reconcile (advance every `codex:requested` PR)

For each open-or-closed PR labelled `codex:requested`, find our most recent `@codex review` comment on it, then gather **all** of Codex's activity **after** that comment. Codex delivers its verdict in one of two shapes and you MUST check **both** — a `get_reviews`-only check silently misses the most common outcome:

- a **formal review** — visible in `get_reviews` / `get_review_comments`. Codex uses this when it has **inline findings**.
- a **plain issue comment** from the Codex bot — visible in `get_comments`, **not** in `get_reviews`. Codex uses this for a **no-findings verdict** (e.g. "Codex Review: Didn't find any major issues. Keep them coming!") and for **usage/rate-limit** messages.

"Codex" = the bot that reacted 👀 to our trigger, or any account whose login contains `codex` (e.g. `chatgpt-codex-connector[bot]`). Classify from reviews **and** comments together:

- **Inline findings present** — any `get_review_comments` thread authored by Codex after our trigger, or a review that requests changes → relabel **`codex:reviewed`**.
- **Completed, no findings** — a Codex review that approves / is summary-only, **OR** a plain Codex *comment* signalling no issues (e.g. "Didn't find any major issues"), **OR** only a 👍 reaction → relabel **`codex:clean`** (done). ⚠️ This clean verdict most often arrives as a **comment, not a review**, so checking only `get_reviews` will miss it and leave the PR stuck in `codex:requested` until it falsely stalls — always check `get_comments` too.
- **Usage/rate-limit message** — a Codex comment like "You have reached your Codex usage limits…" → relabel **`codex:rate-limited`**, record the time. Do **not** count this against the wait budget.
- **No response yet** (no Codex review **and** no Codex comment after our trigger):
  - If a reactions-capable tool is available and there is **no 👀** on our trigger comment after two cadence cycles → Codex never picked it up → treat as throttled: relabel **`codex:rate-limited`**.
  - Else compute elapsed = now − our latest trigger-comment time. If `> 180 min`, **check the round count** = how many `@codex review` comments we've posted on this PR (this is the durable counter — comments persist even if the container cycles). If this is already the **3rd** attempt (2 retries used) → relabel **`codex:needs-human`** (terminal — Codex never converged, escalate to a person). Otherwise relabel **`codex:stalled`** (retryable). If still `≤ 180 min`, leave `codex:requested` as-is (a wakeup will re-check).

### Pass B — File ONE issue per PR (drain every `codex:reviewed` PR)

**No subagents, no worktrees, no fix PRs.** This pass only reads findings and creates issues. **File exactly ONE issue per source PR**, aggregating *all* of that PR's findings into a single checklist — never one issue per finding.

Process the `codex:reviewed` PRs **oldest first** — ascending merge date (equivalently, lowest PR number first) — so issues are filed in the same old→new order the reviews were requested.

For each PR labelled `codex:reviewed`:

1. `STATUS: 🗂️ #<pr> filing`. Collect **all** of Codex's findings on the PR: **each inline review comment is one finding**; also scan the top-level review body for any finding not attached to a specific line. For each finding capture: a short summary (the bolded headline), the severity (`P1`/`P2`/`P3` if present), the file path + line, the description, and the comment's `html_url`.
2. **Dedup (idempotency).** Before filing, check whether an issue already exists **for this PR**: search issues (open **and** closed) for the marker `codex-findings pr=<pr>` in the body (`gh issue list --search '"codex-findings pr=<pr>"' --state all` or the MCP `search_issues`). **If one already exists, skip filing** (just relabel the source and move on) — never file a second issue for the same PR.
3. If not already filed, **create ONE GitHub issue** aggregating every finding:
   - **title:** `[Codex] Review findings for #<pr> — <short PR title> (<n> finding(s))`.
   - **labels:** `agent-fix`, `codex-finding` (both auto-create on first use).
   - **body:**
     ```
     Auto-filed from a Codex review of merged PR #<pr> — <pr title>.

     **Source PR:** #<pr>
     Codex flagged **<n>** finding(s) on this PR — each is a checkbox below with its own file/line and Codex comment link. Fix them together (or split into follow-ups as you see fit).

     ### Before fixing, read the source context
     Do **not** fix these in isolation. First open the **source PR #<pr>** and read the diff that shipped, then read each **Codex review comment** linked below for the exact reasoning and the file/line it flagged. Confirm each finding still applies to `main` before changing anything — the code may have moved since merge.

     ---

     <for each finding, one checklist item:>
     - [ ] **[<Pn>] <headline>** — `<path>:<line>` ([Codex comment](<html_url>))
       <finding description, with the trailing "Useful? React 👍 / 👎." line stripped>

     ---

     _Filed by `/review-to-issues`. Labelled `agent-fix` so `/fix-loop` will fix it._

     <!-- codex-findings pr=<pr> -->
     ```
4. **Outcome for the source PR:**
   - Filed the issue (or it already existed from a prior run) → relabel source **`codex:filed`** (terminal). `STATUS: ✅ #<pr> filed issue #<n> (<count> findings)` (or `already filed`).
   - The PR was `codex:reviewed` but **no** finding is parseable (shouldn't happen — Pass A only marks reviewed when findings exist) → relabel source **`codex:needs-human`**, `STATUS: 📝 #<pr> needs human — reviewed but no parseable findings`.

### Pass C — Sweep (enroll new merges, trigger up to the cap)

1. **Cooldown gate.** If any PR carries `codex:rate-limited` whose timestamp is within the last **30 min**, skip the rest of Pass C (we're in circuit-breaker cooldown). Also re-arm any `codex:rate-limited` PR whose 30 min has elapsed back to `codex:queued`.
   - **Re-queue stalls.** Relabel every `codex:stalled` PR back to `codex:queued` for another attempt. This is always safe: a PR only reaches `codex:stalled` while still under the retry cap — once the 3rd attempt times out, Pass A sends it to `codex:needs-human` instead, so a re-queued stall can never loop forever.
2. **Enroll — sweep periodically, read the WHOLE window.** List PRs merged within the lookback window that have **no** `codex:*` label and label each **`codex:queued`**. Two things matter:
   - **Sweep periodically, NOT every tick.** You do not need to re-enroll on every 3-min reconcile: while a `codex:queued` backlog already exists, a newly-merged PR would just wait in that same queue behind everything else, so re-scanning adds nothing to throughput (the bottleneck is the `K=2` review cadence, not enrollment). The *only* purpose of re-sweeping is to make sure no merge slips out of the lookback window before it's ever enrolled — which a periodic sweep covers with huge margin. So sweep **when the queue is empty** (before you'd otherwise go idle/terminal) and **at most once per ~30 min otherwise**; skip the sweep on the intervening ticks. Track the last-sweep time (or just sweep on the first tick after each 30-min mark). A cheap probe is a negative-label search that returns *only* un-enrolled merges: `merged:>=<window> -label:codex:queued -label:codex:requested … -label:codex:skip` — no full re-scan needed.
   - **Read the whole window, not the default page.** When you do sweep, pass an explicit high `--limit` (e.g. `gh pr list --state merged --search "merged:>=<window>" --limit 300`) or fully paginate the search API — `gh pr list` defaults to **30** and a few days can merge far more (e.g. 80+), so an unbounded call silently skips the older merges.
   (This command never opens PRs, so there are no fix PRs of its own to exclude; if you also use `/review-merged-prs`, its `codex:fix` PRs already carry a `codex:*` label and are skipped by the "no `codex:*` label" filter.)
3. **Respect the cap — oldest first.** Count in-flight = PRs labelled `codex:requested`. While `in-flight < K` (=2) **and** a `codex:queued` PR exists, promote **one**, always choosing the **oldest** queued PR — process the queue in ascending order of merge date (equivalently, lowest PR number first). This guarantees older merges are reviewed before newer ones and never starve behind a growing backlog. Post `@codex review`, relabel it **`codex:requested`**, `STATUS: 🚀 #<pr> review requested`. Promote at most a couple per invocation to stay gentle.

### Arm the next wakeup

> Skip this whole section when a scheduler (e.g. `/loop`) invoked you and owns the schedule — it decides the next tick and the stop condition instead. Run it only when this command drives itself.

If **any** PR is left in a non-terminal state (`codex:queued`, `codex:requested`, `codex:rate-limited`), schedule the next check with `send_later`:

- normal waiting (`codex:requested` present) → **+2 min**.
- only backing off (all non-terminal PRs are `codex:rate-limited` / cooldown) → **+30 min**.
- message: re-invoke this command, e.g. `Run /review-to-issues <window> — codex review wakeup`.

**Terminal condition — stop cleanly.** If nothing non-terminal remains (every PR in the window is `codex:filed` / `codex:clean` / `codex:needs-human`, and the sweep found no new un-labelled merges to enroll), the backlog is drained:

- Print `STATUS: 🏁 nothing in flight` and a one-line tally: `n filed · n clean · n needs-human · n stalled · n in-flight` plus the total count of issues created this run.
- **Do not arm a `send_later` wakeup.**
- **If you were invoked under `/loop`, end the loop now** — call `ScheduleWakeup` with `stop: true` (ends a dynamic `/loop`, i.e. one started with no interval). A fixed-interval loop (`/loop 30m …`) cannot self-terminate — run this command **standalone** or under a **dynamic `/loop`** (no interval) if you want it to stop on its own.

Do not stop merely because everything is *in flight* — only when everything is *terminal*. Being mid-wait (`requested`/`rate-limited`) is not done; arm the wakeup and continue.

**When it's done:** the findings are now `agent-fix` issues in your backlog. Run **`/fix-loop`** (or `/fix-next-issue` under `/loop`) to fix them.

## Hard rules

- **This command never writes code, never opens a PR, never spawns a subagent.** It only triggers Codex reviews and files issues.
- **One issue per PR, never per finding.** Aggregate all of a PR's findings into a single checklist issue.
- **Never file a duplicate issue.** Always dedup by the `codex-findings pr=<pr>` marker before creating an issue — one issue per source PR, ever.
- **Every filed issue must carry `agent-fix`** — otherwise `/fix-loop` won't pick it up.
- **Every filed issue must point the fixer at the source PR and each finding's Codex review comment** (all go in the body template) and tell it to read them before fixing — so the fix is grounded in the original change and Codex's reasoning, not the distilled issue text alone.
- Never comment `@codex` in reply to a comment Codex itself wrote (that spawns an unrelated Codex task). Only comment `@codex review` as a top-level PR comment.
- Never exceed `K=2` in-flight reviews; always honor the cooldown.
- A throttle never consumes the wait budget; a timeout is `codex:stalled` (retryable), not `codex:needs-human`.

## Status legend

`STATUS:` at every transition: 🚀 review requested · ⏳ awaiting Codex · 🗂️ filing · ✅ filed · 🟢 clean · 🐢 rate-limited (backing off) · 💤 stalled (retryable) · 📝 needs human · 🏁 nothing in flight
