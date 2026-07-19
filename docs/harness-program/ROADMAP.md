# Harness program roadmap

Maintained by the program lead; reconciled at each portfolio review. Milestones are
dependency-ordered, not dated — the changeset brief's own sequencing lean ("the ratification
seam first, since everything ratifies through it") is adopted as the spine.

## M0 — program stands up (current)

- Program canon lands in `docs/harness-program/` (this PR); Mike's merge ratifies it.
- Labels created; issues #71–77 adopted and relabeled; steering-bound toolsmith issues
  re-triaged per the [steering↔toolsmith contract](./contracts/steering-toolsmith.md).
- `ENG_TEAM_INSTRUCTIONS.md` for this repo written.
- Stakeholder issues filed in attest-it (pure-consumption verification; presence-backed vs.
  automation signer) and vaultkeeper (judge keypair custody).
- Command-steering PM and ratification PM kick off from their charters; toolsmith PM receives
  a scope-change handoff.

## M1 — the seam and the engine (parallel tracks)

- **Ratification PM**: changeset frontmatter schema spec; CI validation contract (seal
  validity, signer authorization per gate, frontmatter well-formedness, supersedes
  integrity); the porcelain fill-seal-PR tool; config-repo bootstrap flow (the config
  monorepo is created by this flow, not by hand); reconciler design.
  - Program decision to drive here: **where the reconciler lives** (this layer vs. each
    consumer pulling its packages) — flagged in the changeset brief.
- **Command-steering PM**: engine extraction from toolsmith (#74); verdict payload schema
  (#72) — a contract, co-signed by toolsmith PM; registered-target predicates (#73);
  telemetry triangle; the bash-coverage experiment (sample real transcripts, measure
  known-command coverage vs. bail quality — from
  [bash-command-safety-analysis](./bash-command-safety-analysis.md)).
- **Toolsmith PM**: staged/live split (#75); attest-it admission (#76); steering
  registration emission (#77).

## M2 — the reasoning layer and the harness layer

Gate: verdict schema + adjudicator affordance ratified (steering), ratification flow usable.

- **Judge PM stands up.** Judge harness, intent-document format, triage policy
  (probation: block-and-pass-through before any auto-allow), judge identity enrollment
  (needs the attest-it/vaultkeeper stakeholder answers from M0).
- **Harnesses PM stands up.** Launcher, layer materializer, base config root, first vertical
  slice (the public API reviewer, per the brief's lean).
- Program decision to make **before M2 kicks off**: *is the config monorepo also the
  harness layered-source repo?* The changeset monorepo invariant and the harness
  materialized-branch design strongly suggest yes — one repo, `main` = layered source,
  materialized branch = artifact. Recorded in [DECISIONS](./DECISIONS.md) when ruled.

## M3 — convergence

- Judge crystallization loop live: rulings become steering config via signed changesets.
- Toolsmith graduation thresholds (initially a manual human call per tool, per the brief).
- Monitored near-term use in the tool-development harness (judge on the critical path).
- The dogfooding ratchet closes: program config decisions ride the ratification flow; the PM
  roster migrates onto agent-type harnesses.
