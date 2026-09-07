---
description: Haiku-only fleet for mechanical sweeps — you decompose, they execute, every claim carries a command you can re-run
argument-hint: <the mechanical work to fan out>
---

Decompose "$ARGUMENTS" into explicit, narrow, independently-checkable jobs yourself, then run:

Workflow({ name: "grunt", args: { jobs: ["job 1", "job 2", ...] } })

The decomposition is your job — the fleet does not plan, and a vague job produces a confident wrong
answer rather than an error. Each job should name what to search, where, and what counts as a hit.

**Only send work where checking the answer is cheaper than producing it**: call-site hunts, counts,
"which files import X", log scraping, running a command and reporting output. Never send judgment,
design, or code that has to be right on first read — verifying that costs more than doing it.

## Reading the result

`confirmed` means one haiku reproduced another haiku's command. That is a filter, not a proof —
both can be wrong the same way, and the schema cannot tell a real line number from a plausible one.

Before any finding changes what you do:
- Run its `command` yourself. One bash call. That is why the commands are attached, and `spotCheck`
  collects the first few for exactly this.
- Treat `unconfirmed` and `unchecked` as if they were never written. Do not repeat them to the user
  as facts, and do not quietly promote one because it sounds right.
- Read `searched` before believing any negative result — "no other callers" only ever means "not
  matched by these patterns".
- `notFound` and `unsure` are real output, not empty results. A job that found nothing did its job.

When you report to the user, say which claims you personally re-ran. Never present an unverified
haiku claim as something you know.
