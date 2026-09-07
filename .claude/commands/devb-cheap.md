---
description: Cost-aware dev loop — a router picks the route and model tiers per task, escalating to opus only on judgment or failure
argument-hint: <what to build or fix>
---

Run the `devb-cheap` workflow, passing the task text as `args`:

Workflow({ name: "devb-cheap", args: "$ARGUMENTS" })

This is an explicit user request for multi-agent orchestration — call the Workflow tool directly,
do not ask first. If `$ARGUMENTS` is empty, ask what to build instead of launching.

The caller can cap or force the route: `args: {task: "...", maxRoute: "small"}` refuses to go above
`small`; `args: {task: "...", force: "micro"}` pins it. Use those only if the user asks — the
sensitive-path floor that routes to `deep` is there for a reason and `force` overrides it.

When it returns, report:
1. **Route taken and why**, plus `agentsSpent` — the user is running this one for cost.
2. **Verifier verdict**, failing output verbatim. If `diagnosis` is present, say what failed, whether
   it was pre-existing, and whether the repair round fixed it.
3. **Review findings** if a review ran; say plainly it was skipped if not.
4. **What changed**, as `path:line` bullets.

If the route was `deep`, the full `devb` pipeline ran instead — report its gate decision first.
