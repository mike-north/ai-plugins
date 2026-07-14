---
name: file-issue
description: Draft and file a self-contained, pickup-ready issue for the fleet
arguments:
  - name: topic
    description: What the issue is about (free text; the work to be filed)
    required: false
---

Draft a **pickup-ready** GitHub issue for the engineering fleet about `$ARGUMENTS.topic`.

Follow `skills/product-led-eng-fleet/resources/issue-authoring.md`. The implementer who
picks this up has no conversation context, so the issue must stand alone. Produce:

- **Problem** — what's wrong/missing and why it matters now (1–2 sentences).
- **Governing references** — links to the spec sections / docs that constrain the solution.
- **Acceptance criteria** — concrete, testable statements ("X returns Y when Z"); these are
  the contract.
- **Non-goals** — what's explicitly out of scope.
- **Proof** — the test or observable behavior that demonstrates done.

Size it to ~one agent's unit of work (split separable tracks into separate issues). Put any
real deadline in the title as `(due YYYY-MM-DD)` and apply priority labels — the queue ranks
on those. If a design choice is unresolved, label it `needs-decision` and do not queue it for
pickup. Show me the drafted issue and confirm before creating it with `gh issue create
--title <T> --body-file <draft.md> [--label …]`.
