# Toolsmith: product framing and principles

Mike North · 2026-07-15

> **Scope note (added 2026-07-19).** Predates toolsmith's narrowing
> ([toolsmith-narrowed](../harness-program/toolsmith-narrowed.md)). The two approvals, the two tool
> archetypes, and the role-to-authority thesis remain **governing**. §"Steering principles for the
> hooks" is **superseded** → [command-steering](../command-steering/architecture-steer.md).
> One correction worth flagging inline: the enforcement sentence in §"The two approvals" describes
> the PreToolUse hook returning `permissionDecision: allow` on a valid grant. Under the ratified
> [contract](../harness-program/contracts/steering-toolsmith.md) §2, **steering never emits
> `allow`** — native permission rules are the sole grantor and steering only subtracts. See the
> [canon map](./README.md).

This doc defines what Toolsmith is optimizing for, the vocabulary the other docs assume, and the lines we hold. The [architecture steer](./architecture-steer.md) makes the case; this doc is the reference for day-to-day design calls.

## The problem, in one sentence

Agents rationally gravitate toward the most general, most dangerous tools; humans cannot safely evaluate general capability one invocation at a time; so we change the unit of approval from the invocation to the signed, narrow, verifiable tool.

## What Toolsmith optimizes for, in priority order

1. **Agent discovery, understandability, usability, and token efficiency.** Agents are the primary users. Every design decision — naming, output format, help text, error shape — is evaluated first by whether an agent finds the tool, invokes it correctly on the first try, and pays the minimum token cost to do so.
2. **Composability.** Tools are parts in pipelines the forger didn't anticipate. Structured interchange (JSON between tools, TOON only at the terminal hop), stdout/stderr discipline, and exit-code contracts exist so tools click together.
3. **Easy refactor and a platforming mindset.** We build ingredients on the critical path to the thing we set out to build — the forge runtime SDK, the linter, the manifest, the environment profile — because each ingredient makes every subsequent tool smaller, more uniform, and more reviewable. The toolbox is expected to be continuously reshaped by the curator; nothing in the design may assume tools are frozen.
4. **Humans are secondary, but not ignored.** The human gets the above-the-fold summary line, the signing review surface, prettier rendering at a TTY, and the `.md` documentation. The human does not get interactivity, progress theater, or veto-by-default over agent workflows.

When priorities conflict, the lower number wins. A prettier human rendering that costs agent tokens on the default path loses. A composability affordance that makes tools harder for agents to discover loses.

## Core vocabulary

- **Forged tool** — a small, signed script capturing one narrow, recurring usage pattern of a command that is dangerous in general. Named for the command it retires (`gh-merge` retires a class of `gh` invocations).
- **Toolbox** — the set of currently signed tools, plus the catalog skill that makes them discoverable.
- **The curator** (toolsmith sub-agent) — the plugin-shipped sub-agent responsible for forging, modifying, refactoring, and cataloging tools, and for maintaining detection patterns and the catalog skill description.
- **Forge runtime / SDK** — the signed, versioned bundle of shared helpers every tool sources (see [runtime spec](./runtime-spec.md)).
- **Proposal gate** — the deterministic checks (shellcheck + forge rule pack via eslint-sh) a proposal must pass before it is eligible for human review and signing.
- **Vaultkeeper** — external library owning secret backends and grant storage. Toolsmith never touches key material directly.

## The two approvals

These are distinct and must never be conflated in UX or implementation:

1. **Toolbox admission.** Binds a human signature to a tool's content hash. Requires a human physical action (YubiKey tap, 1Password unlock). Answers: *may this capability exist in executable form?*
2. **Usage authorization.** A grant tuple: tool hash × scope × expiry. Scope ∈ {global, `session:<id>`, `agent_type:<type>`}. Expiry ∈ {indefinite, time-boxed, per-invocation}. Answers: *who may run it, and under what terms?* The agent proposes terms with the tool; the human adjusts at approval time.

Enforcement lives in the PreToolUse hook: verify signature against pinned hash, look up an unexpired matching grant, return `permissionDecision: allow`; anything else returns `ask`, falling back to the normal human-approval flow. **Failure degrades to asking, never to silent denial or silent allowance.**

## The two tool archetypes

**Precondition tools** encode *when*. All guards execute inside the tool, at invocation time, atomically with the action — never as agent-side reasoning beforehand (time-of-check/time-of-use gaps are the failure mode). Each guard fails with its own named exit code and a legible, actionable error. Example: `gh-merge`.

**Authority tools** encode *what*. There is no precondition that makes the action correct — the check exists to capture a judgment call — so safety comes entirely from capability narrowing: one named verb, one direction, one target. Defaults for the archetype: one-way operations (pass-only; walking back is a human act), a required `--rationale` that is posted where humans will see it, and credentials scoped as tightly as the platform allows so the token's narrowness stacks under the tool's narrowness. Example: `gh-product-sign-off`.

The two product stories to keep in view, because together they are the pitch:

> *Fable 5 agents of type `code-reviewer` have use of `gh-merge`, which merges only if all review threads are resolved, a Copilot review is in place, all CI checks pass (required and non-required), api-extractor reports no public API surface change, and the commit history is free of agent-attribution footers.*

> *Agents of type `product_manager` can use `gh-product-sign-off` to explicitly flip the "Product approval" GitHub check to pass.*

One shows autonomy earned through verification; the other shows authority delegated through narrowing. Model gating ("Fable 5 agents") is achieved transitively: the agent-type definition pins its model, so trusting the role trusts the model. The toolbox is thereby a **role-to-authority map** — organizational design expressed as signed scripts.

## Steering principles for the hooks

- **Surface cost; soft-block, never hard-block** raw dangerous commands. A genuinely novel command passes through untouched; a command in the `ask` set that no forged tool covers gets a *soft* block — a `deny` that surfaces the cost and points at `/toolsmith`, which the agent can override for a deliberate one-off with a trailing `# toolsmith:proceed` marker (falling back to the harness's own `ask`). The soft block fires only on commands the config already marks approval-worthy, so it never punishes the long tail. Cost = "requires per-invocation human approval" (derived from the harness permission config: anything set to `ask`) + pattern density from the log. See [steering & gap-adjudication](./steering-adjudication.md) for the exact mechanism.
- **Redirect only on high confidence**, using detection patterns authored by the curator and approved alongside the tool they point to.
- **Log everything into the telemetry triangle**: invocations + outputs (post-hook), redirects and asks (pre-hook). Redirect volume is a *semantic activation* defect signal, not a success metric — the goal is agents finding the tool first.
- **The moment stays unblocked.** A human may approve one raw invocation while the forge proceeds in the background; incident response never waits on tool-building.

## Non-goals (v1)

- **Multi-user and team sharing.** No shared toolboxes, no graduation between project/user/team scopes, no consolidation across people. Earned later.
- **Audit-grade provenance.** We do not track which tool version informed which agent decision. Agents adapt to evolving tool surfaces; the problem we're solving is permission fatigue and safe autonomy, not compliance. (The telemetry log incidentally helps, but it is not a commitment.)
- **Proposal back-pressure.** If agents flood the human with proposals, we'll solve it when it happens.
- **Windows, initially.** The design pattern reserves PowerShell as the escape hatch; the v1 target is macOS/Linux.

## Failure modes we design against, explicitly

- **Review-fatigue relocation** — moving fatigue from invocations to proposals. Countered by the proposal gate, the SDK keeping scripts thin, and visible lint-disable exceptions inside the hash.
- **Over-scoped forging** — the curator producing a tool that recreates broad access with extra steps. Countered by the archetype defaults, the design-pattern ruleset, and the human holding the narrowness line at signing.
- **Discovery failure** — tools exist but agents don't reach for them. Countered by the catalog skill's curated description, prefix naming, `--help` quality, and redirect telemetry as the alarm.
- **Trust drift** — the meaning of a signature changing silently. Countered by exact version pins on everything the proposal gate comprises (linter, rule packs, SDK); every pin bump is a deliberate curator event with human approval.
