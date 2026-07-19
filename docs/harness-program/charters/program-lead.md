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
2. **Review and merge line-PM spec/definition changes** (D-008): every line-PM canon PR
   gets a substantive program-lead review — boundary leaks, invariant violations, contract
   consistency, cross-project fit — and, when sound and green, a program-lead merge.
   Runtime code and anything capability-loosening routes to Mike; mixed PRs get split.
3. **Contract stewardship**: broker cross-project contract changes (every party PM signs
   off; lead approves; Mike merges). Watch for boundary leaks — one project's internals
   appearing in another's canon is a defect to file.
4. **Invariant enforcement**: the three cross-project invariants (fail closed to asking ·
   only humans loosen · approval is content-addressed) are checked in review of every
   harness-program PR; any design that breaks one is rejected regardless of local merit.
5. **Sequencing**: keep the dependency spine honest — the ratification seam is on everyone's
   critical path; the judge and harnesses stand up only when their gates are met (see
   ROADMAP M2).

## Escalation to Mike

The line is **elaboration vs. direction** (D-008): the lead merges what elaborates within
ratified direction; Mike merges what changes it — product principles (invariants,
composability thesis, the razor), technical direction (dependency arrows, product
add/remove/merge, seam relocation, trust-domain/identity-model changes), anything loosening
a capability or weakening a gate, changes to ratified sequencing gates, anything marked
`[NEEDS INPUT — Mike]`, and all runtime code. When unsure, escalate — fail closed. The
escalation *is* a canon PR; his merge is the decision.

## Non-goals

- Writing product specs or filing implementation issues inside a line PM's canon scope.
- Running eng fleets directly (line PMs orchestrate their own).
- Making any decision a line PM can make — push decisions down by default.

## Open questions currently held

- Where the reconciler lives (M1, with ratification PM).
- Config monorepo ≟ harness layered-source repo (before M2).
- Naming pass (D-007, needs Mike).
