# Command-steering canon

Design canon for the **command-steering** plugin — the deterministic, programmable permission
layer of the harness program. These documents govern the fleet issues labeled
`plugin: command-steering`; where an issue and this canon disagree, **the canon wins until
amended**. Canon becomes governing when the PR that lands it is merged to `main` (the program's
ratification event — see the [program README](../harness-program/README.md) governance line); until then the docs
below marked _draft_ are proposals, not rules.

The program-level brief this canon serves is
[command steering](../harness-program/command-steering.md); the cross-project agreement it is
party to is the [steering ↔ toolsmith contract](../harness-program/contracts/steering-toolsmith.md).
This canon may sharpen and specify, but never contradict, those two documents — a contradiction is
an escalation to the program lead, not a local edit (see the charter,
[`command-steering-pm`](../harness-program/charters/command-steering-pm.md)).

## Status

**Skeleton (M1).** The plugin as shipped lives inside the toolsmith plugin's PreToolUse hook; the
program has ruled that steering becomes its own plugin and toolsmith drops its hook (issue #74).
This canon is the destination the extraction lands against. The substrate spec — the verdict log,
`steering` config, ask-cost surfacing, fatigue, and latency budget — is authored in **PR #67**
(landing at `docs/toolsmith/steering-spec.md`, not yet on `main`) and **transfers into this canon** on
that PR's merge per the contract's Related note; the telemetry doc below is its forward-looking home
and marks the transfer explicitly.

## Reading order

1. [`architecture-steer.md`](./architecture-steer.md) — what the engine _is_: the deterministic
   policy engine, the two-stage hot path, the richer verdict model that replaces dead-end
   allow/ask/deny, the adjudicator affordance, and the telemetry triangle. Start here.
2. [`verdict-payload-schema.md`](./verdict-payload-schema.md) _(draft — issue #72)_ — the exact
   shape of the richer return type: fields, fillers, per-harness serialization, and the three brief
   examples as concrete payloads. The product _is_ this return type.
3. [`telemetry-schema.md`](./telemetry-schema.md) _(draft — contract §5)_ — the telemetry triangle
   steering owns and toolsmith (later the judge) reads: the three legs, their schema and location,
   and the read-only stability contract.
4. [`command-pattern-matcher.md`](./command-pattern-matcher.md) _(draft — issue #95, ruling D-011)_ —
   the one program-wide command-pattern match semantics steering owns and everyone else consumes by
   version reference: the match function, the semver compatibility contract, and the fail-closed
   version-reference model. Graduates into a `steering ↔ ratification` contract when that schema
   ratifies.

The **deterministic bash static-analysis core** — shell-grammar parse, leaf enumeration, command
profiles, cwd tracking, dynamic-construct bail — is command-steering input per the
[bash-command-safety-analysis](../harness-program/bash-command-safety-analysis.md) split ruling. Its
first cheap bet (the coverage-vs-bail-quality experiment) is filed as a pickup-ready issue.

## The one-paragraph version

The harness gives three payload-less verdicts — allow, ask, deny — and all three are dead ends: a
deny can't say _why_, an ask can't say _what it costs_, neither can say _what to do instead_.
Command steering sits in the PreToolUse hook and replaces those with verdicts that teach — deny
carrying a reason, deny carrying a runnable redirect, ask carrying the approval cost — computed
deterministically from declarative config, with **no model on the invocation path**. It is an
allowlist-building loop: everything dangerous is gated by default and safe shapes get carved out
incrementally, each carve a fact some other project (toolsmith, later the judge) _registers_ into
steering's config through a shared file seam. Steering executes that config; it never originates it.
Three invariants hold everywhere and any design that breaks one is wrong:

- **Fail closed to asking** — every ambiguity, missing match, or unavailable adjudicator degrades to
  the normal human-approval flow. Never silent denial, never silent allowance.
- **Only humans loosen** — steering may propose and unilaterally tighten; opening any capability
  requires a human signature. Steering itself **never emits `allow`**.
- **Approval is content-addressed** — integrity pins bind exact content; any change voids the pin
  and fails closed to asking.

Redirect volume is a _defect signal_ (agents finding the raw command before the safe target), never
a success metric.
