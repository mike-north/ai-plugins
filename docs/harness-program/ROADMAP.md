# Harness program roadmap

Maintained by the program lead; reconciled at each portfolio review. Milestones are
dependency-ordered, not dated — the changeset brief's own sequencing lean ("the ratification
seam first, since everything ratifies through it") is adopted as the spine.

## M0 — program stands up · **COMPLETE 2026-07-19**

All done: program canon ratified (PR #78, + governance amendments #82/#90/#93); labels
created; #71–77 adopted and relabeled; steering-bound issues re-triaged per the
[steering↔toolsmith contract](./contracts/steering-toolsmith.md); `ENG_TEAM_INSTRUCTIONS.md`
written; stakeholder issues filed (attest-it #149/#150 — #149's pure-consumption
verification came back **confirmed on all three assumptions**; vaultkeeper #261);
command-steering and ratification PMs kicked off charter-only and shipped their canon
skeletons (PRs #87 and #84, both merged and governing).

## M1 — the seam and the engine (parallel tracks) · **current**

- **Ratification PM**: canon skeleton ✅ (frontmatter schema draft, CI validation contract,
  porcelain sketch, bootstrap flow). Fleet dispatch order: #85 (schema validator) →
  #86 (CI action) + #88 (porcelain `propose`) → #89 (`init` bootstrap) → #94 (reconciler +
  apply-manifest format).
  - Reconciler placement **ruled** (D-010: in the ratification layer, declarative
    per-package apply manifests).
- **Command-steering PM**: canon skeleton ✅ (architecture steer, verdict-payload schema
  draft resolving the redirect-confidence question, telemetry schema). Next: #95 matcher
  spec (D-011 — one program-wide matcher, steering-owned; field shape
  `commandPattern: { pattern, matcherVersion }` agreed with ratification on #92), then
  engine extraction #74, predicates #73, #72 AC2 per-harness verification, bash-coverage
  experiment #83.
- **Toolsmith PM**: staged/live design ✅ merged (PR #111) — implementation dispatching;
  then attest-it admission (#76) and steering registration emission (#77, gated on the
  matcher dialect via #95 Part B/#74). Handoff delivered; #44 and #40 closed as superseded.
- **Judge PM** (canon-first per D-013): canon skeleton ✅ merged (PR #103 — triage policy,
  intent format, crystallization, identity design, risk vocabulary); all four
  ratification-schema answers delivered (#92); intent document v1 at Mike's gate (PR #104,
  `decider: mike`); design issues #105–#107 in queue, M2 work parked `backlog`
  (#108–#110).
- **Cross-track**: `contracts/steering-ratification.md` drafting from the PR #97 record
  (matcher spec §2–§5 + both PMs' sign-offs); formal party acks + Mike's merge finalize it
  alongside the schema's ratification. The M2 repo question is ruled: **the config
  monorepo is the harness layered-source repo** (D-015).

## M2 — the reasoning layer and the harness layer

Gate: verdict schema + adjudicator affordance ratified (steering), ratification flow usable.

- **Judge PM stands up.** Judge harness, intent-document format, triage policy
  (probation: block-and-pass-through before any auto-allow), judge identity enrollment
  (needs the attest-it/vaultkeeper stakeholder answers from M0).
- **Harnesses PM stands up.** Launcher, layer materializer, base config root, first vertical
  slice (the public API reviewer, per the brief's lean).
- ~~Program decision to make before M2 kicks off: config monorepo ≟ harness
  layered-source repo~~ **Ruled (D-015): one repo** — `main` = layered source (config
  packages + harness layers), materialized branches = per-agent-type artifacts. The
  harnesses PM's stand-up gate is now only: ratification flow usable + Mike's launch.

## M3 — convergence

- Judge crystallization loop live: rulings become steering config via signed changesets.
- Toolsmith graduation thresholds (initially a manual human call per tool, per the brief).
- Monitored near-term use in the tool-development harness (judge on the critical path).
- The dogfooding ratchet closes: program config decisions ride the ratification flow; the PM
  roster migrates onto agent-type harnesses.
