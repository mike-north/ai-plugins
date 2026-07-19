# The changeset layer: signed, committed config decisions

> **Status**: adopted into the harness program canon 2026-07-19 (moved from the original brainstorm drafts). Governs fleet work per [README](./README.md).


Mike North · 2026-07-18

One of six companion docs. Start with [How the pieces fit](./how-the-pieces-fit.md). This is the thin adapter that repurposes [changesets](https://github.com/changesets/changesets) as the ratification vehicle for agent-proposed configuration — consumed by [the judge](./judge.md), [Toolsmith](./toolsmith-narrowed.md), and [command steering](./command-steering.md), and sealed by [attest-it](./attest-it-substrate.md).

> **[NEEDS INPUT]** This layer needs a name.

## Why this exists

The human ratification gate across the whole system is a PR merge — config-as-code, rediscovered honestly. That immediately raises the question of what, exactly, gets signed. We worked through the failure sequence deliberately, and the layer's design is the residue:

1. **Sign the PR description** (signature embedded in an HTML comment, CI strips-then-verifies the visible body). Fails: GitHub descriptions are mutable server-side state.
2. **Add a merge queue** to validate at the last instant. Fails: hit "enter merge queue," then edit the description back — a classic time-of-check/time-of-use gap, the exact class the Toolsmith design patterns warn about for guards.
3. **Sign a committed file in the diff.** The commit is immutable and content-addressed; editing the description touches nothing load-bearing. We were about to invent a change-log folder with one file per change when we recognized we were reinventing changesets — so we use changesets.

With the seal on committed content, the merge queue falls back out: tampering means a new commit, CI re-fires, the seal fails. Fewer moving parts, same guarantee.

The PR description survives as **a pointer, not a payload**: a URL to the rendered changeset file at the head ref of the PR branch. Mutable surface for ergonomics, immutable surface for trust. The head ref is fine — no SHA-updating bookkeeping — because CI validates whatever the head resolves to, on every push.

## What the layer adds on top of native changesets

Native changesets assume a human author writing a release note about a code change. Ours differ in specific, enforceable ways:

- **The author is usually an agent** — the judge, or the Toolsmith curator — signing with its own identity.
- **The payload is a config decision** carrying the structured frontmatter below, plus the judge's risk template in the body (necessary evil vs. low concern, factors weighed) where applicable.
- **The file is sealed** via attest-it; CI validates seal and signer authorization against the trusted base.
- **A porcelain tool does the mechanics.** The judge shouldn't hand-roll Ed25519 signing any more than a coding agent should hand-roll `gh api` — one narrow tool fills the template, seals the file, opens the PR. The layers compose on themselves.

## The frontmatter schema

The changeset's second reader is the judge at PreToolUse decision time, a thousand reads to the human's one. The frontmatter is the schema of the judge's crystallized memory — a queryable index, not prose. The governing principle: **cheap deterministic lookup first; expensive reasoning only on a miss.**

Proposed fields:

- **Command pattern** — machine-matchable, so "have I already ruled on this shape?" is a lookup, not a re-derivation. The single highest-leverage field.
- **Verdict and direction** — deny / redirect / open, and tightening vs. loosening.
- **Intent reference** — stable intent id (e.g. `ssh-always`), plus **intent document version and numbered section(s)** the decision interprets. The intents are the constitution; each changeset is case law citing its article. Revise an intent and you can instantly query every ruling that cited the old section, instead of silently enforcing yesterday's constitution.
- **Judge harness version** — which mind made this call. A ruling from an older harness deserves different weight; on upgrade, "every live rule crystallized by a version older than N" is a query. Same trust-drift discipline as the exact pins in the runtime spec.
- **Triggering observation** — the actual command that provoked the ruling; the judge's memory of the real attempt.
- **Risk level / necessary-evil flag** — the judge inherits its own prior calibration.
- **Signer identity** — judge vs. human.
- **Ratification status** — proposed vs. ratified.
- **Scope** — global / agent-type / session — and **expiry**, if any, matching the grant-tuple vocabulary.
- **Supersedes** — pointer retiring an older ruling, so the log doesn't accrete contradictions the judge can't resolve.

## The monorepo invariant

Changeset folders traditionally map one-to-one with a git repo, and changesets handle monorepos natively — so we lean in rather than fight it. The config surface is a monorepo: `settings.json`, hook config, steering rules, the toolbox, each a "package." A judge decision that spans several artifacts — forge a tool here, tighten a hook rule there — is a multi-package change: **one atomic decision, one changeset, one PR, one human approval, one merge**, with each package keeping its own coherent per-artifact changelog. No half-applied decisions where the tool landed but the rule didn't.

**Critical decision**: do all config surfaces genuinely live in one repo, or does physical reality force them apart — dotfiles here, a plugin repo there? If split, we either accept multiple changeset roots and lose the unified log, or build an aggregation layer, which is complexity. My lean: make the config monorepo a real single repo and preserve the one-to-one invariant rather than working around it.

## The byproduct

We reached for changesets to close a TOCTOU gap and got a complete, human-readable changelog of every configuration decision — what the judge changed, why, what risk it flagged, when the human ratified — for free. That log is quietly load-bearing twice over: it's the audit trail of the system's evolving trust posture, and it's the judge's institutional memory, readable back so boundaries aren't rediscovered from scratch.

## Open questions

- **Exact frontmatter serialization and the CI validation contract** need a spec: what the GitHub Action checks (seal validity, signer authorization per gate, frontmatter well-formedness, supersedes integrity) and in what order.
- **Who reconciles?** After merge, some deterministic step applies main to the live system — placing tools, flipping executable bits, updating `settings.json`. Where that reconciler lives (this layer, or each consumer pulling its own packages) is undecided.
