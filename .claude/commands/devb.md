---
description: Managed tiered dev loop — manager scopes, architect designs, opus plans, sonnet implements, haiku verifies, opus reviews, manager gates
argument-hint: <what to build or fix>
---

Run the `devb` workflow for this task, passing the task text as `args`:

Workflow({ name: "devb", args: "$ARGUMENTS" })

This is an explicit user request for multi-agent orchestration — call the Workflow tool directly,
do not ask first. If `$ARGUMENTS` is empty, ask the user what to build instead of launching.

When the workflow returns, report in this order:
1. **The manager's gate decision** (SHIP / REWORK / ESCALATE) and its rationale. If ESCALATE, put
   the escalation question to the user directly — that is the whole point of the run.
2. **The verifier's verdict** with any failing spec output verbatim. Never soften a FAIL.
3. **The reviewer's confirmed findings.**
4. **What changed**, as `path:line` bullets, and how many rework rounds it took.

Do not fix anything the gate did not order. Ask first.
