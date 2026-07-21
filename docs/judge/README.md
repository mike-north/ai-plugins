# The judge (working name)

Canon for **the judge** — an adversarial reasoning agent that triages the ask set (accident
prevention and desperation pushback, never anti-malice) and converges its expensive rulings
into cheap deterministic rules crystallized into command steering.

> **Status**: skeleton, drafts. These documents become **governing canon when merged to
> `main`**. Until then they are proposals under review — cite them in issues, but expect
> churn. "The judge" is a working name pending
> [DECISIONS D-007](../harness-program/DECISIONS.md); the eventual rename is mechanical.

## Governance

These documents govern the fleet issues labeled **`plugin: judge`**. Where an issue and this
canon disagree, **the canon wins until amended** — comment on the issue rather than building
the divergence. Amendments are ratified by PR merge; no other ceremony exists (per the
[program README](../harness-program/README.md)).

The judge line is currently **canon-first** (ruled 2026-07-19): design everything, run
nothing. All runtime judge work — hook wiring, adjudicator implementation, live triage —
remains gated on M2: steering's verdict-payload schema ratified, the adjudicator-affordance
contract handed over, and the identity-custody answers (attest-it#150, vaultkeeper#261).
M2-gated issues carry `backlog` until the gate lifts.

## Reading order

1. **Governing brief** — [the judge](../harness-program/judge.md). The two failure classes
   (accidents, desperation), the three-way triage, the ratchet. Everything here specifies it.
2. [triage-policy](./triage-policy.md) — the probation posture (first principle), the trust
   asymmetry, context starvation, and provenance requirements.
3. [intent-format](./intent-format.md) — the intent-document format and lifecycle: the
   constitution the changeset frontmatter's `intentRef` cites.
4. [crystallization](./crystallization.md) — ruling → signed changeset → steering rule; the
   shape-lookup; the crystallized-memory read path.
5. [identity-and-enrollment](./identity-and-enrollment.md) — the judge's signing identity:
   attest-it enrollment scoped to the config-change gate, authorship-never-endorsement,
   custody, and the risk-template (changeset body) ownership.
6. [risk-vocabulary](./risk-vocabulary.md) — the calibration vocabulary that feeds
   ratification's `riskLevel` enum.
7. [risk-template](./risk-template.md) — the changeset body the judge signs: required
   sections, rules, and worked examples.

## What the judge does not own

The judge is deliberately a **consumer** at every shared seam. Redefining any of these
surfaces locally is a defect:

| Surface | Owner | Binding |
|---|---|---|
| Command-pattern matching | command-steering — the one matcher, consumed **by version**, never reimplemented | [D-011](../harness-program/DECISIONS.md), steering's matcher spec (#95 Part A) |
| Enforcement / verdict emission | command-steering — the judge is a registered adjudicator producing a *signal*, never a decision; it can only yield a richer `deny` or `ask` | [architecture-steer](../command-steering/architecture-steer.md) §"The adjudicator affordance" |
| Verdict-payload schema | command-steering (custody until M2 handover per [D-001](../harness-program/DECISIONS.md)) | [verdict-payload-schema](../command-steering/verdict-payload-schema.md) |
| Changeset carrier, frontmatter header schema, CI validation, reconciler | ratification layer | [ratification canon](../ratification/README.md), [D-010](../harness-program/DECISIONS.md), [D-012](../harness-program/DECISIONS.md) |
| Signing substrate | attest-it, consumed **unmodified** (pure consumption confirmed, attest-it#149) | [attest-it-substrate](../harness-program/attest-it-substrate.md) |
| Telemetry (history / steering logs) | command-steering; the judge is a **read-only** consumer | [telemetry-schema](../command-steering/telemetry-schema.md) §reader contract |

The dependency is one-way by design: the judge consumes steering's affordance; **steering
knows nothing of the judge**, and the system must degrade gracefully with the judge removed
([D-001](../harness-program/DECISIONS.md)).

## The three invariants

Every design in this canon holds all three (program-wide):

- **Fail closed to asking.** Judge unavailability, error, timeout, or any ambiguity degrades
  to the normal human-approval flow. Never silent denial, never silent allowance.
- **Only humans loosen.** The judge may propose anything and unilaterally tighten; opening
  any capability requires human ratification. This applies to the judge's own posture too:
  no principle in this canon may be weakened except by a human-merged amendment.
- **Approval is content-addressed.** Every ruling the judge signs binds to exact content;
  any change voids the seal.
