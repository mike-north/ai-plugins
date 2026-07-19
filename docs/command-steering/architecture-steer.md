# Command steering: architecture steer

> **Status**: canon skeleton (M1). Directional architecture for the command-steering plugin. Governs
> `plugin: command-steering` issues per the [README](./README.md); where an issue disagrees, the
> canon wins until amended.

This is the orienting document for anyone implementing or reviewing steering. It says what the
engine _is_ and where its parts sit; the two companion docs specify the two interfaces that need
their own precision — the [verdict payload](./verdict-payload-schema.md) (what steering returns) and
the [telemetry triangle](./telemetry-schema.md) (what steering records). It restates neither. It
serves, and never contradicts, the program brief
([command steering](../harness-program/command-steering.md)) and the
[steering ↔ toolsmith contract](../harness-program/contracts/steering-toolsmith.md).

## The problem, restated in one line

The harness only builds walls; the product is road signs. A deny that can't say why, an ask that
can't say what it costs, and neither able to say what to do instead — that dead-endedness is the
entire thing steering exists to fix (program brief, "The problem").

## What steering is, structurally

Four properties, each load-bearing and each an invariant a PR can violate:

1. **Deterministic, always.** Declarative configuration, pattern detection, routing — **no model on
   the invocation path**. Accuracy of command-pattern matching is _the_ core engineering problem: a
   redirect to the wrong tool is worse than no redirect. Anything requiring judgment is deferred off
   the path through the adjudicator affordance (below), never resolved inline by a model.
2. **An allowlist-building loop.** Everything dangerous is gated by default; safe shapes are carved
   out incrementally. Given a command, steering answers from its config — it neither knows nor cares
   whether an approved target is a toolsmith-forged tool or a porcelain CLI command (program brief,
   "What it is, structurally").
3. **An affordance for external decision-makers.** For patterns the config can't resolve, steering
   may call a _registered_ adjudicator for a signal. The dependency points one way: the judge (Phase
   2) depends on this affordance; **steering knows nothing about the judge**
   ([how the pieces fit](../harness-program/how-the-pieces-fit.md), the dependency graph). Until the
   judge stands up, the affordance may be a stub that always declines — steering must degrade
   gracefully to more asking with no adjudicator present.
4. **Fail-closed to asking.** No valid config match, adjudicator unavailable, anything ambiguous →
   the verdict degrades to the normal human-approval flow. Never silent denial, never silent
   allowance.

## Steering executes config; it never originates it

Every carve-out in steering's config arrives as a _fact registered by another project_ through the
shared version-controlled file seam — never through an API, never authored by steering itself
(contract §1). Toolsmith registers detection patterns, approved targets, integrity pins, and grant
tuples at tool-admission time; the judge (Phase 2) proposes steering rules via signed changesets.
Steering's job is to execute that config in the hook, deterministically. Config changes ride the
program's shared ratification flow (human PR merge = ratification); **loosening never happens without
a human signature**, while tightening may be proposed unilaterally because a restriction always
degrades safely to asking.

## The verdict model: three legs, never `allow`

Steering replaces the three dead-end verdicts with a richer return type. The single hard invariant
that bounds every path: **steering never emits `permissionDecision: allow`** — an LLM is not the
security boundary for prompt-injection-adjacent input, and grants (not steering) are the enforcement
path that produces `allow`. Steering only ever produces a richer `deny`, a richer `ask`, or a
**defer** (emit nothing; the harness runs its normal permission flow). `deny` is reserved; every
other outcome is a defer.

| Leg | Trigger | Verdict | Notes |
|---|---|---|---|
| **Redirect** | A watched command matches an **approved** target's coverage. | `deny` naming the target with a runnable, filled invocation. | The strongest teaching case. The suggested form MUST match what the native rule actually allowlists (the #36 §1 deadlock rule) or the redirect is worse than none. |
| **Soft block** | A command in the effective `ask` set that **no** approved target covers. | `deny` surfacing the cost, pointing at the forge flow, warning against circumvention. | Escape hatch: a trailing `# proceed` marker makes the hook **defer** to the harness's own `ask`. |
| **Ask, cost surfaced** | An `ask`-gated command where the payload carries approval-cost + pattern density. | `ask` with the cost in the reason. | The agent decides whether the cost is worth paying or worth routing around via a forge proposal. |
| **Registered-target predicate** | Invocation of a registered tool path. | Integrity mismatch → `ask` (fail closed); no valid grant → `ask`; valid grant → **defer**. | Content-addressed enforcement (contract §2). Never `allow`. |
| **Everything else** | No match; genuinely novel command. | **defer** (emit nothing). | Never blocked. Blocking punishes the long tail. |

The _shape_ of a redirect (subset / gap / no-cover legs, the tiered
template→adjudicator→floor mechanism, the parameterized filled invocation) is specified in the
toolsmith-side [steering-adjudication](../toolsmith/steering-adjudication.md) design and transfers alongside the substrate spec; this steer names the legs, the payload doc types
them, and neither restates the tier mechanism.

## The two-stage hot path

Extraction (#74) preserves the proven architecture, it does not redesign it:

1. **Fast gate (sh, stat-exit).** On the **not-opted-in** path — no registry, no steering config —
   the gate stat-exits before spawning node. This path's whole reason for existing is that it is
   near-free for shells that never opted in. **Nothing may be added ahead of the gate's stat-exit on
   this path** — not an adapter, not a config read, not a log write (the #38 latency budget; the #34
   adapter decline turns on exactly this).
2. **Node brain.** For opted-in projects, node runs the watchlist merge (defaults → user → project,
   #68 semantics), the redirect/soft-block/ask-cost resolution, the registered-target predicates, and
   the single verdict-log write — all inside the one already-running node process, adding no new
   spawn.

The measured budget (#38) is a ratio-and-invariant assertion, not hardcoded milliseconds; `bench.sh`
comes along in the extraction (or gets a sibling). The budget is re-asserted post-extraction on the
same bench (#74 AC3).

## Per-harness emission

Steering emits only the calling host's shape, never both, so a host that rejects unknown fields
cannot fail the hook into a silent allow. The three grounded shapes (from the shipped
`toolsmith-check.mjs` / `cursor-shim.mjs`): Claude and Codex read
`hookSpecificOutput.permissionDecision` + `permissionDecisionReason`; Cursor reads a flat
`{ permission, user_message, agent_message }`; **defer is the absence of output**. The
[verdict-payload schema](./verdict-payload-schema.md) owns the field-by-field serialization table and
the per-harness hazards (Codex's `updatedInput` auto-approve class); this steer only records that
emission is host-shaped and defer-by-omission.

## The telemetry triangle

Steering owns the telemetry triangle — invocations+outputs (PostToolUse), redirects and asks
(pre-hook). It is local, load-bearing product surface (what the toolsmith curator and later the judge
read), not analytics. Redirect volume is a **semantic-activation defect signal**, never a success
metric: rising redirects mean agents are finding the raw command before the safe target — a curation
problem to fix, not a win to celebrate. Schema, location, and the read-only stability contract are in
[telemetry-schema.md](./telemetry-schema.md).

## The adjudicator affordance

For patterns the config can't resolve, steering exposes a registered-adjudicator affordance and asks
it for a _signal_, never a decision. The judge is one such adjudicator (Phase 2). Two rules make this
safe:

- **The affordance is off the critical path's floor.** Adjudicator unavailability, error, or timeout
  degrades to the guaranteed floor verdict; the permission decision is never blocked waiting on it.
- **The affordance can only ever produce a richer `deny` or `ask`.** A misclassification is bounded
  to a benign outcome (one wasted agent turn, or one unnecessary human `ask`) — never an auto-allow.

Until the judge PM stands up, command-steering holds custody of the adjudicator-affordance contract
and the verdict-payload schema (per [DECISIONS D-001](../harness-program/DECISIONS.md)); moving that
boundary is a program-lead escalation.

## Non-goals

- **No reasoning at runtime.** Judgment belongs to the judge, reached through the affordance.
- **No tool lifecycle.** Staged/live, graduation, and signing are toolsmith's; steering routes to
  targets its config declares valid.
- **No signing or key handling.** Ratification of steering config rides the changeset layer and
  attest-it; steering only consumes the result.
