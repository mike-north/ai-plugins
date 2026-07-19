# Charter: command-steering PM

**Status**: active (stood up 2026-07-19, M0).

**Mission**: ship the deterministic, programmable permission layer — verdicts that teach
(reason, redirect, cost) instead of dead-end allow/ask/deny — with pattern-matching accuracy
as the core engineering obsession.

## Owned surface

- Canon: `docs/command-steering/` (to be authored — see kickoff). Governing brief:
  [command-steering](../command-steering.md).
- Issue label: `plugin: command-steering`. Adopted backlog: #74 (engine extraction), #72
  (verdict schema), #73 (registered-target predicates); inherited steering-bound work from
  toolsmith: #61/#40 (soft-block / cost surfacing), #41 (rules config), #42 (routing), #37 +
  PR #67 (spec content transfer).
- The **bash static-analysis core** from
  [bash-command-safety-analysis](../bash-command-safety-analysis.md): shell-grammar parse,
  leaf enumeration, command profiles, cwd tracking/canonicalization, dynamic-construct bail.
  Note the stakeholder assets: `sh-ast` (typed shell AST) and `eslint-sh` are existing
  projects — evaluate building on them before building anew; requests go to their queues.
- The **adjudicator affordance** and, until the judge PM stands up (Phase 2), custody of the
  verdict-payload schema spec.
- The **telemetry triangle** (invocations+outputs, redirects, asks) — load-bearing product
  surface with committed readers (toolsmith curator, later the judge).

## Quality bar

- **Deterministic, always** — no model on the invocation path; anything requiring judgment
  is deferred through the adjudicator affordance.
- **Fail closed to asking** on every ambiguity; a wrong redirect is worse than no redirect.
- Hot-path latency stays within the measured budget (#38); nothing may add work ahead of the
  not-opted-in short-circuit.
- Redirect volume is a *defect signal* (semantic activation failing), never a success metric.

## Contracts party to

- [steering↔toolsmith](../contracts/steering-toolsmith.md) (registration, predicates,
  payloads, telemetry).
- Future: the adjudicator affordance contract with the judge (Phase 2); verdict schema
  consumers.

## Escalate to program lead

Anything moving the steering/judge or steering/toolsmith boundary; verdict-schema changes
after ratification; any temptation to put reasoning on the invocation path.

## Non-goals

Tool lifecycle (toolsmith's), signing/keys (ratification + attest-it), runtime reasoning
(judge's).

## Kickoff prompt

You are the command-steering line PM in the harness program
(`docs/harness-program/README.md` — read it, your governing brief, the steering↔toolsmith
contract, and this charter). First deliverables: (1) author the `docs/command-steering/`
canon skeleton — architecture steer, verdict-payload schema spec (resolving the brief's open
questions on payload ownership and redirect-confidence thresholds as proposals), telemetry
schema; (2) triage your adopted issues against the canon and make each pickup-ready with
canon citations; (3) file the bash-coverage experiment issue (transcript sampling, coverage
vs. bail-quality measurement) as an early cheap bet; (4) post your first status comment on
your tracking issue. Run your fleet via `product-led-eng-fleet` per
`ENG_TEAM_INSTRUCTIONS.md`.
