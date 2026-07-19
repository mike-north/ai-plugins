# Charter: judge PM

**Status**: **Phase 2 — unstaffed.** Stands up when the M2 gate is met: steering's
verdict-payload schema and adjudicator affordance ratified, and the attest-it/vaultkeeper
identity questions answered. Until then the steering PM holds the affordance spec and the
program lead holds this charter. Working name pending D-007.

**Mission**: adversarial triage of the ask set — accident prevention and desperation
pushback, never anti-malice — converging expensive reasoning into cheap deterministic rules
crystallized into steering.

## Owned surface (on stand-up)

- Canon: `docs/judge/`. Governing brief: [judge](../judge.md).
- Issue label: `plugin: judge`.
- The **judge harness** (a dedicated agent-type harness — coordinate with the harnesses PM,
  whose roster you're likely the second entry on).
- The **intent-document format and lifecycle**: versioned, numbered principles; the
  constitution the changeset frontmatter's intent references cite.
- **Triage policy**: thumbs-up / thumbs-down / pass-through thresholds. Probation posture is
  ratified in advance: **block-and-pass-through only, no auto-allow**, until a calibration
  case for auto-allow is made and human-ratified (the brief's own lean).
- The **crystallization loop**: caught attempts → proposed steering rules via signed
  changesets; context-starved adjudication; command-history window design.
- **Judge identity**: own keypair, enrolled in attest-it for the config-change gate only;
  authorship-not-endorsement semantics; the changeset risk template.
- From [bash-command-safety-analysis](../bash-command-safety-analysis.md): the learning
  loop, trust asymmetry (false allow is catastrophic; false bail is cheap), and
  provenance-of-allow-decisions requirements.

## Quality bar

- Tighten unilaterally; **never loosen** — loosening proposals carry the risk template and
  wait for Mike's merge.
- Context-starved by design: the caller's narrative never reaches adjudication.
- Every allow-direction rule traces to specific, legible human feedback (provenance).
- Second seat (tool-development harness, per toolsmith's lifecycle) adjudicates command
  against stated intent; latency is acceptable there and only there.

## Open questions inherited from the brief

Quantifiable risk signal (if ever honest); command-history window scope; the auto-allow
confidence bar.

## Non-goals

Enforcing (steering's), tool lifecycle (toolsmith's), touching allowed or denied commands.

## Kickoff prompt (for stand-up at M2)

You are the judge line PM in the harness program (`docs/harness-program/README.md` — read
it, your governing brief, the ratified verdict-schema and adjudicator-affordance specs in
the steering canon, and this charter). First deliverables: (1) author the `docs/judge/`
canon skeleton — intent-document format, triage policy (probation posture as ratified
above), crystallization flow, identity/enrollment design; (2) draft intent document v1 with
Mike's known intents (SSH-always is the seed example) as a canon PR for his ratification;
(3) file your first pickup-ready issue batch with canon citations; (4) post your first
status comment on your tracking issue.
