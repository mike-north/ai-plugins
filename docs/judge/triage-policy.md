# Triage policy (draft)

> **Status**: draft — becomes governing when merged. Governing brief:
> [the judge](../harness-program/judge.md) §"What the judge is". The probation posture in §1
> was ratified in advance in the [judge PM charter](../harness-program/charters/judge-pm.md)
> and is restated here verbatim, not weakened.

The judge operates **purely on the ask set** — the commands the harness's tool-use
permissions mark `ask`. Denied commands stay denied; allowed commands run; the judge never
touches either.

## 1. The probation posture (first principle, ratified)

**Block-and-pass-through only, no auto-allow**, until a calibration case for auto-allow is
made and human-ratified.

Concretely: of the brief's three triage outcomes —

- **Thumbs down** (high confidence unsafe → blocked immediately): **active**.
- **Pass through** (murky → the normal ask flow): **active**, and the guaranteed floor.
- **Thumbs up** (appears safe → never reaches the human): **inactive during probation.**
  Enabling it is a loosening event: it requires a written calibration case (what evidence,
  over what volume, at what error rate justifies the bar) ratified by Mike's merge as a
  canon amendment to this document. No other path exists.

This is not caution for its own sake; it is the [trust asymmetry](#3-trust-asymmetry)
applied to the judge itself. During probation every judge error is cheap.

## 2. Context starvation (by design)

The caller's narrative never reaches adjudication. The judge does not see the calling
agent's goal, its approaches already tried, or its accumulated frustration — desperation
cannot leak in and argue its case.

What the judge *can* see:

- The command under adjudication (via steering's adjudicator affordance).
- The **intent document** ([intent-format](./intent-format.md)) — the constitution.
- Its own **crystallized memory** — ratified changesets ([crystallization](./crystallization.md)).
- **Command history**, read-only from steering's telemetry
  ([telemetry-schema](../command-steering/telemetry-schema.md)) — the one cross-command
  context, because escalation patterns are visible from the outside even when each
  individual command looks plausible.

**Open (line-PM decision, not yet ruled): the command-history window.** Escalation
detection needs enough window to see drift; the right scope (session, day, agent type) is
undecided. Tracked as a design issue; until ruled, no design in this canon may assume a
window wider than the current session.

## 3. Trust asymmetry

From the judge-assigned sections of
[bash-command-safety-analysis](../harness-program/bash-command-safety-analysis.md):

- **False bail** (unnecessary human ask): cheap, forgivable. Iterate freely.
- **False allow** (bad command waved through): catastrophic and asymmetric — one bad
  let-through destroys the trust a thousand correct decisions built.

Design consequences, binding on all judge work:

- Learning to *bail more* (from denials) is low-stakes and may be automated.
- Learning to *allow more* (from approvals) is the dangerous direction and is **never
  automatic**. A bare approval is weak evidence — it may reflect the pattern being safe, or
  just this instance, or rubber-stamp fatigue. Only approvals carrying a **legible reason**
  ("safe *because* the path resolves inside the sandbox") are candidates for real rules.

## 4. Provenance (the trust instrument)

Every allow-direction rule must trace back to the specific pieces of legible human feedback
that authorized it. The frontmatter's provenance fields (`intentRef.*`,
`triggeringObservation`, `judgeHarnessVersion` — see
[frontmatter-schema](../ratification/frontmatter-schema.md)) exist to make that trace
queryable. The payoff: when a rule turns out to have a gap, the post-mortem is not "the
black box was wrong" but "these approvals composed into a policy with a gap *here*" — a
specific, editable line.

## 5. Authority

- **The judge may unilaterally tighten.** Restricting is always safe — everything degrades
  to asking.
- **The judge may never unilaterally loosen.** Opening a capability is where the human
  signature lives, full stop. Loosening proposals carry the risk template
  ([risk-vocabulary](./risk-vocabulary.md)) and wait for Mike's merge.

## Non-goals

- Not a runtime gate on allowed commands; never involved with denied ones.
- Not anti-malice or anti-prompt-injection. Accident prevention and desperation pushback only.
- Not the permission engine — steering enforces; the judge proposes and adjudicates.
