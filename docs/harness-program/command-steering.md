# Command steering: a programmable permission layer

> **Status**: adopted into the harness program canon 2026-07-19 (moved from the original brainstorm drafts). Governs fleet work per [README](./README.md).


Mike North · 2026-07-18

One of six companion docs. Start with [How the pieces fit](./how-the-pieces-fit.md) for the dependency graph and the boundary rules between projects. This doc stands alone otherwise — a PM agent should be able to break it into tasks without reading the others.

> **[NEEDS INPUT]** "Command steering" is a working name. All five project names in this doc set are placeholders pending a naming pass.

## The problem

Harnesses give us three verdicts on a tool-use request: allow, ask, deny. All three are dead ends — none can carry a payload. A deny can't say *why*. An ask can't say *what it costs*. Neither can say *what to do instead*.

The consequences show up daily:

- Agents reach for `curl` where a porcelain CLI exists for the same job — one API-key misuse away from something dangerous.
- Agents hand-build GraphQL queries with `gh api` when a `gh` porcelain command does the exact same thing — and broad `gh api` access is unapprovable, because it's difficult to even define the set of objectionable things it can do.
- A blocked agent just stays blocked. `rm` is denied, the agent grinds, and nobody tells it there was a safe path the whole time.

We don't want to enumerate what's objectionable about broad commands. We want to incrementally define what's *safe*, and open exactly that for autonomous use.

## What command steering is

A deterministic policy engine that sits in the PreToolUse hook and replaces three dead-end verdicts with verdicts that teach:

- **Deny, but say why** — the refusal carries the reason.
- **Deny, and say what to do instead** — "you just tried to delete a folder in the temp directory; that command won't run, but `rm-tmp` lets you freely delete things in temp. It already accounts for path traversal. Go nuts, as long as it's scoped to that folder."
- **Ask, with the cost surfaced** — "this requires per-invocation human approval, and something similar has been invoked 42 times in the last six hours." The agent decides whether that cost is worth paying or worth routing around via a forge proposal.

It's the difference between a wall and a road sign. The harness only builds walls. The richer return type is the whole product.

## What it is, structurally

- **Deterministic, always.** Declarative configuration, pattern detection, routing. No model on the invocation path. Accuracy of command-pattern matching is the core engineering problem — a redirect to the wrong tool is worse than no redirect.
- **An allowlist-building loop.** Everything dangerous is gated by default; safe shapes get carved out incrementally. A Toolsmith-forged tool is one kind of approved target; a porcelain CLI command is another. Steering doesn't know or care which — given a command, it answers from its config.
- **An affordance for external decision-makers.** For patterns the config can't resolve, steering can call out to a registered adjudicator for a signal. [The judge](./judge.md) is one such adjudicator. The dependency points one way: the judge depends on steering's affordance; steering knows nothing about the judge.
- **Fail-closed to asking.** No valid config match, adjudicator unavailable, anything ambiguous → the verdict degrades to the normal human-approval flow. Never silent denial, never silent allowance.

## Telemetry

Steering owns the telemetry triangle: invocations and outputs (post-hook), redirects and asks (pre-hook). This is local, load-bearing product surface — it's what the judge and the Toolsmith curator read — not analytics. Redirect volume is a *semantic activation* defect signal, not a success metric: rising redirects mean agents are finding the raw command before the safe target, which is a curation problem to fix, not a win to celebrate.

## How its config changes

Steering executes config; it never originates it. Changes arrive through the ratification flow shared by all the projects: proposed as signed changesets in the config repo (see [the changeset layer](./changeset-layer.md)), ratified by a human PR merge, picked up deterministically. The judge is the primary proposer; the human is always the merge gate. Loosening never happens without a human signature; the judge may propose tightening unilaterally (a restriction is always safe — it degrades to asking).

## Non-goals

- **No reasoning at runtime.** Anything requiring judgment belongs to the judge, reached through the adjudicator affordance.
- **No tool lifecycle.** Whether a forged tool is signed, staged, or graduated is Toolsmith's problem. Steering just routes to targets its config declares valid.
- **No signing or key handling.** Ratification of steering config rides the changeset layer and attest-it; steering only consumes the result.

## Open questions

- **Where's the confidence threshold for redirect vs. cost-surfacing?** Redirecting on a false positive sends the agent to the wrong tool; only surfacing cost forever means the toolbox under-delivers. Static threshold, or tuned from redirect-outcome telemetry? (Inherited from the original Toolsmith steer — it lives here now.)
- **Who owns redirect payloads — steering, or its consumers?** Detection patterns are authored by the Toolsmith curator and ship with the tools they point to; the judge crystallizes deny-with-explanation rules. Does steering define the payload schema and consumers fill it, or do consumers push fully-formed verdicts in? We deliberately left this open.
- **What is the verdict payload schema?** The richer return type is the product; its exact shape (reason, redirect target, corrected invocation, cost signal) needs a spec before implementation starts.
