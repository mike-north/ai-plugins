# Command steering: the verdict payload schema

> **Status**: **draft proposal** (issue #72). This document resolves the _shape_ of steering's
> return type as a proposal; **ownership is already settled** — steering defines the schema,
> consumers fill it (contract §3). It becomes governing canon when Mike merges. The remaining
> completion work #72 tracks is the empirical per-harness verification (AC2) — the Claude Code row
> below is grounded in the shipped emitter, the Codex and Cursor rows are grounded in the toon /
> cursor-shim code but must be re-verified against each harness's _current_ contract before the
> draft locks.

The product _is_ the richer return type (program brief, "What command steering is"). The harness
gives three payload-less verdicts — allow, ask, deny; steering replaces them with verdicts that carry
a reason, a runnable redirect, and a cost signal. This document types every field, names who fills
it, maps it onto each harness's real hook contract, and expresses the three brief examples as concrete
payloads.

## Design invariants (non-negotiable, each independently testable)

1. **No payload shape may carry or imply `permissionDecision: allow`.** An LLM is not the security
   boundary for prompt-injection-adjacent input; grants (not steering) produce `allow`. Every steering
   payload is a richer `deny`, a richer `ask`, or a **defer** (emit nothing). This is the program's
   "only humans loosen" invariant at the wire level.
2. **A registered redirect must be runnable as-is.** The `filledInvocation` must match the form the
   native permission rule actually allowlists — the #36 §1 deadlock rule. A redirect the agent cannot
   run without hitting another prompt is worse than no redirect.
3. **Fail closed.** Any field a filler could not supply is `null`, and a `null` where a leg needs a
   value degrades that leg's _hint quality_ (e.g. a bare tool pointer instead of a filled invocation),
   never its _permission verdict_. Missing data never upgrades a verdict toward allow.
4. **Captures are attacker-adjacent.** Any value extracted from the denied command and echoed into a
   `filledInvocation` is narrow-class and render-time-validated
   ([steering-adjudication](../toolsmith/steering-adjudication.md) safety invariant 2); extraction
   failure degrades to the generic redirect.

## The internal payload (steering's canonical shape)

Steering computes one canonical, host-neutral payload internally, then serializes it to the calling
host's shape (next section). The canonical shape:

```jsonc
{
  "verdict": "deny" | "ask" | "defer",   // never "allow"; "defer" serializes to no output
  "leg": "redirect" | "soft-block" | "ask-cost" | "integrity" | "grant",
  "reason": {
    "audience": "model" | "human",       // deny reason reaches the model; ask reason reaches the human
    "text": "string"                     // human/agent-readable prose
  },
  "redirect": {                          // present on the redirect leg, else null
    "target": "gh-pr-reactions",         // approved target name (forged tool or porcelain command)
    "filledInvocation": "gh-pr ...",     // runnable as-is (invariant 2), or null → bare pointer
    "rationale": "string"                // why this target covers the attempt (from registration)
  } | null,
  "cost": {                              // present on ask-cost / soft-block, else null
    "approval": "per-invocation",        // derived from the harness ask set (§ask-cost surfacing)
    "density": 42,                       // pattern density from the telemetry log, or null
    "window": "6h"                       // the density window, or null
  } | null,
  "provenance": {                        // which rule/registration produced this verdict
    "source": "registration" | "rule" | "watchlist" | "ask-set" | "adjudicator",
    "ref": "string"                      // registry entry id, rule id, or adjudicator signal id
  }
}
```

### Field ownership — who fills what (contract §3)

| Field | Filled by | When |
|---|---|---|
| `verdict`, `leg` | **steering** | at hook evaluation, deterministically |
| `reason.audience` | **steering** | fixed per leg (deny→model, ask→human) |
| `reason.text` | **steering**, decorated from filler data | at evaluation |
| `redirect.target` / `rationale` | **toolsmith** (registration) | tool admission (contract §1) |
| `redirect.filledInvocation` | **steering** (Tier 1 template) or the adjudicator (Tier 2) | at evaluation, from the registered template + captures |
| `cost.approval` | **steering** | resolved from the harness `ask` set |
| `cost.density` / `window` | **steering** | read from the telemetry log |
| `provenance` | **steering** | at evaluation |
| judge-crystallized rule payloads | **the judge** (Phase 2), via signed changeset | ratification |

Steering owns the schema and every field's _shape_; consumers own only the _content_ of the fields
the contract assigns them. A consumer may never add a field or change a type — that is a
schema-versioned change steering must lead (contract §5's "must not break readers without a versioned
change" extends to writers).

## Per-harness serialization

Steering emits **only the calling host's shape**, never a union, so a host that rejects unknown fields
can't fail the hook into a silent allow (grounded in `toolsmith-check.mjs`'s `deny()` comment). A
**defer** is the absence of stdout on every harness.

| Canonical | Claude Code _(grounded: `toolsmith-check.mjs`)_ | Codex _(grounded: toon `.codex-plugin`; **verify current contract — #72 AC2**)_ | Cursor _(grounded: `cursor-shim.mjs`)_ |
|---|---|---|---|
| `verdict: deny` | `hookSpecificOutput.permissionDecision: "deny"` | same `hookSpecificOutput` shape | `permission: "deny"` |
| `verdict: ask` | `hookSpecificOutput.permissionDecision: "ask"` | same | `permission: "ask"` |
| `verdict: defer` | emit nothing (exit 0) | emit nothing | emit nothing |
| `reason.text` (model) | `permissionDecisionReason` | `permissionDecisionReason` | `agent_message` |
| `reason.text` (human) | `permissionDecisionReason` | `permissionDecisionReason` | `user_message` |
| `redirect` / `cost` prose | folded into `permissionDecisionReason` | folded into `permissionDecisionReason` | folded into `agent_message` / `user_message` |

**Codex `updatedInput` hazard (verify, do not assume).** #72 flags Codex's `updatedInput` class:
Codex has treated `hookSpecificOutput.updatedInput` presence alongside a decision as an auto-approve
signal (the toon plugin's Pre-rewrite finding). Steering **never** emits `updatedInput` and never
`allow`, so it is structurally clear of the hazard — but the per-harness verification (#72 AC2) must
confirm that emitting `deny`/`ask` with no `updatedInput` serializes correctly on the current Codex
contract, not the one the toon findings captured.

**What reaches whom.** On `deny`, the reason reaches the _model_ (the agent reconsiders before an
approval is spent); on `ask`, the reason reaches the _human_ (who is about to approve). Cursor splits
these into `agent_message` / `user_message` explicitly; Claude/Codex carry one
`permissionDecisionReason` string whose audience is implied by the decision. Verify this
model-vs-human routing against each harness's current docs as part of #72 — it is asserted here from
the shipped shim, not from the harness spec.

## The three brief examples, as concrete payloads

The program brief names three verdicts that teach. Each as a canonical payload:

### 1. `rm-tmp` redirect (deny, say what to do instead)

Agent runs `rm -rf /tmp/scratch/build`; a `rm-tmp` tool covers temp-scoped deletion.

```json
{
  "verdict": "deny",
  "leg": "redirect",
  "reason": { "audience": "model",
    "text": "That won't run. rm-tmp lets you freely delete inside the temp directory — it already accounts for path traversal. Run: rm-tmp scratch/build" },
  "redirect": { "target": "rm-tmp", "filledInvocation": "rm-tmp scratch/build",
    "rationale": "temp-scoped deletion, traversal-safe" },
  "cost": null,
  "provenance": { "source": "registration", "ref": "rm-tmp@sha256:…" }
}
```

### 2. `gh api` → porcelain (deny, say what to do instead)

Agent hand-builds `gh api repos/o/r/pulls/1/comments`; `gh-pr` covers it.

```json
{
  "verdict": "deny",
  "leg": "redirect",
  "reason": { "audience": "model",
    "text": "gh-pr is approved for this and needs no per-call approval. Run: gh-pr comments --repo o/r --pr 1" },
  "redirect": { "target": "gh-pr", "filledInvocation": "gh-pr comments --repo o/r --pr 1",
    "rationale": "PR comments via porcelain; broad gh api is unapprovable" },
  "cost": null,
  "provenance": { "source": "registration", "ref": "gh-pr@sha256:…" }
}
```

### 3. Cost surfacing (ask, with the cost surfaced)

Agent runs a command in the `ask` set that nothing covers.

```json
{
  "verdict": "ask",
  "leg": "ask-cost",
  "reason": { "audience": "human",
    "text": "This requires per-invocation human approval; something similar has run 42 times in the last six hours. No forged tool covers it — /toolsmith can forge one." },
  "redirect": null,
  "cost": { "approval": "per-invocation", "density": 42, "window": "6h" },
  "provenance": { "source": "ask-set", "ref": "Bash(gh api:*)" }
}
```

> The soft-block variant of case 3 is a `deny` (not `ask`) carrying the four-part reason (cost /
> forge pointer / proceed-marker / anti-circumvention), per the transferred substrate spec's §1 legs
> table. Whether a no-cover ask-set command soft-blocks (`deny`) or surfaces cost (`ask`) is the
> redirect-confidence question resolved below.

## The redirect-confidence threshold (proposal — brief open question)

The program brief's standing open question: _"Where's the confidence threshold for redirect vs.
cost-surfacing?"_ Redirecting on a false positive sends the agent to the wrong tool; surfacing cost
forever means the toolbox under-delivers.

**Proposal.** The two are not a tunable continuum — they are distinct legs keyed on a _binary,
deterministic_ fact, and confidence lives only inside the redirect leg's tiers:

1. **A covering match is a redirect** whenever an approved target's registered coverage pattern
   deterministically matches the command (contract §1 `covers`). No score, no threshold — a covers
   match is a covers match.
2. **Confidence degrades hint quality inside the redirect leg, not the leg choice.** Tier 1
   (deterministic template fills validly) → filled invocation. Tier 1 miss but a tool plausibly covers
   → Tier 2 adjudicator classifies subset-vs-gap _off the critical path_. Adjudicator
   unavailable/low-signal → Tier 3 bare pointer. Every tier still emits the redirect `deny`; only the
   `filledInvocation` richness changes
   ([steering-adjudication](../toolsmith/steering-adjudication.md) tiers).
3. **No covering match → the command was never a redirect candidate.** It falls to ask-cost /
   soft-block purely on the deterministic ask-set test.

So there is **no static redirect-vs-cost threshold to tune** — the choice is deterministic, and the
only place "confidence" enters is the redirect leg's own template-validity and adjudicator-signal
tiers, each of which fails closed to a weaker _hint_, never to a wrong _verdict_. If future
telemetry shows redirects landing on wrong tools, the fix is tightening the offending `covers`
pattern (a curation change ratified through the changeset flow), not adding a runtime score.
Escalate to the program lead only if telemetry argues for a genuine scored path — that would move the
"no model on the invocation path" invariant and is not a local decision.

## Open items for #72 completion

- **AC2 empirical verification** of the Codex and Cursor rows against each harness's _current_
  contract (the rows here are grounded in shipped shim code, not re-verified against live harness
  docs).
- **Model-vs-human reason routing** confirmed against each harness's current documentation.
- Lock the canonical field names against the transferred substrate spec's verdict-log `verdict` slugs
  so the payload `leg` and the log `verdict` don't drift (telemetry-schema.md cross-reference).
