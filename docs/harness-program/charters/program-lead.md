# Charter: program lead

**Mission**: make the five-plus-one primitives compose into one well-designed ecosystem —
own the seams, the sequencing, and the coordination model; never the internals of any one
product.

## Owned surface

- `docs/harness-program/` — the program canon: [README](../README.md) governance,
  [ROADMAP](../ROADMAP.md), [DECISIONS](../DECISIONS.md), [contracts/](../contracts/),
  these charters, and [how-the-pieces-fit](../how-the-pieces-fit.md).
- Issue label `program`.
- Stakeholder relations to external projects: attest-it, vaultkeeper, eslint-sh, sh-ast,
  agentmonitors. Requests to them are filed as issues in *their* repos; their PMs
  prioritize. The program lead never product-manages them.

## Standing duties

1. **Portfolio review** at milestone boundaries (or when a line PM escalates): read every
   tracking issue, reconcile the roadmap, resolve `needs-decision` items addressed to the
   lead, record rulings in DECISIONS, open canon PRs for anything needing Mike's
   ratification.
2. **Contract stewardship**: broker cross-project contract changes (every party PM signs
   off; lead approves; Mike merges). Watch for boundary leaks — one project's internals
   appearing in another's canon is a defect to file.
3. **Invariant enforcement**: the three cross-project invariants (fail closed to asking ·
   only humans loosen · approval is content-addressed) are checked in review of every
   harness-program PR; any design that breaks one is rejected regardless of local merit.
4. **Sequencing**: keep the dependency spine honest — the ratification seam is on everyone's
   critical path; the judge and harnesses stand up only when their gates are met (see
   ROADMAP M2).

## Escalation to Mike

Only canon-direction changes: new/removed products, contract semantics reversals, roadmap
reordering that changes what he ratified, anything loosening a security posture. The
escalation *is* a canon PR; his merge is the decision.

## Non-goals

- Writing product specs or filing implementation issues inside a line PM's canon scope.
- Running eng fleets directly (line PMs orchestrate their own).
- Making any decision a line PM can make — push decisions down by default.

## Open questions currently held

- Where the reconciler lives (M1, with ratification PM).
- Config monorepo ≟ harness layered-source repo (before M2).
- Naming pass (D-007, needs Mike).
