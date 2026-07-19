# How the pieces fit

> **Status**: adopted into the harness program canon 2026-07-19 (moved from the original brainstorm drafts). Governs fleet work per [README](./README.md).


Mike North · 2026-07-18

The connective doc for a set of five freestanding primitives. Each project has its own brief and can be built, and read, independently: [command steering](./command-steering.md), [the judge](./judge.md), [Toolsmith](./toolsmith-narrowed.md), [attest-it](./attest-it-substrate.md), [the changeset layer](./changeset-layer.md). This doc owns only what lives *between* them.

**The boundary rule for this doc set**: anything true of only one project lives in that project's brief; anything true of the relationship lives here; neither repeats the other. If steering's internals show up in this doc, the boundary is leaking.

> **[NEEDS INPUT]** All project names except attest-it are working names pending a naming pass.

## The five, in one line each

- **Command steering** — a deterministic, programmable permission layer: verdicts richer than allow/ask/deny, carrying reasons, redirects, and cost.
- **The judge** — an adversarial, intent-driven reasoning agent that triages the ask set and crystallizes its confident decisions into deterministic rules.
- **Toolsmith** — agents propose narrow tools; humans sign them once; grants scope them to agent types; a lifecycle graduates them to autonomy.
- **attest-it** — the human-presence signing substrate: seals bind an authorized identity to exact content; any change voids the seal.
- **The changeset layer** — the ratification vehicle: agent-proposed config decisions as signed, committed changeset files, merged by a human.

## The dependency graph

Arrows point one way, deliberately:

- **Steering depends on nothing above it.** It exposes an adjudicator affordance; it doesn't know who answers. The judge depends on that affordance; steering knows nothing about the judge.
- **The judge writes to the others, reads from its own intents.** It proposes steering rules and Toolsmith forges (via changesets), and sits on the tool-development execution path Toolsmith defines. Nothing depends on the judge — remove it and the system degrades gracefully to more asking.
- **Toolsmith consumes** attest-it (admission seals), the changeset layer (promotion), and steering (registers detection patterns and approved targets).
- **attest-it depends on nothing here** and knows nothing about any of it.
- **The changeset layer** consumes attest-it and native changesets; everyone else consumes the changeset layer.

The git config repo is the seam they all share — they integrate through files under version control, not through each other's APIs.

## The shared contracts

These are the interfaces where projects touch, and the only things that need cross-project agreement:

- **The verdict payload** — steering's return type (reason, redirect target, cost signal). Consumers fill it; steering delivers it. Schema owned by steering's brief; open question there.
- **The changeset frontmatter schema** — the queryable decision record. Owned by the changeset layer's brief.
- **The grant tuple** — hash × scope (global / agent-type / session) × expiry. Defined in the original Toolsmith docs; the changeset frontmatter's scope/expiry fields reuse the same vocabulary.
- **The attest-it gate/signer model** — gates name authorized signers; the judge is a signer scoped to the config-change gate only.

## The ratification flow

One uniform human-approval mechanism across all five, so no project invents its own ceremony:

1. An agent (judge or curator) proposes: a branch in the config repo, a signed changeset, a PR whose description is just a pointer to the rendered changeset.
2. CI validates: seal intact, signer authorized for the gate, frontmatter well-formed — against the trusted base, on every push.
3. A human merges. That merge *is* the ratification.
4. A deterministic reconciler applies main: tools go live, executable bits flip, `settings.json` updates, steering rules activate.

## Cross-project invariants

Three hold everywhere, and any design that breaks one is wrong:

- **Fail closed to asking.** Every verification failure — hash mismatch, missing grant, unavailable adjudicator — degrades to the normal human-approval flow. Never silent denial, never silent allowance.
- **Only humans loosen.** Agents (the judge included) may propose anything and may unilaterally *tighten*; opening any capability requires a human signature. The judge's signature attests authorship, never safety of a grant.
- **Approval is content-addressed.** Seals bind to exact content, travel with the file across machines, and are void the moment the file changes. Time-of-check equals time-of-use: validation happens against the immutable artifact, adjacent to the consequential action.

## Why five projects and not one

The composability thesis, held deliberately: small projects that do a scoped job well, over a monolithic framework that's costly to evolve. The evidence is already in hand — attest-it was built for manual test suites and turned out, unmodified, to be the ratification substrate for this entire system, *because* it was scoped and correct rather than welded into a CI framework. Every seam in this design landed on a boring, proven mechanism (GitOps, changesets, Ed25519, git history) for the same reason. The bet is that these five will keep recombining in ways we didn't design for — and that's the point.

## Open questions

- **Sequencing.** Steering can ship without the judge; Toolsmith's staged/live split can ship without the tool-dev harness; the changeset layer is on everyone's critical path. What's the build order? My lean: changeset layer and the config repo first, since it's the seam everything ratifies through — but this is one for the PM agents to break down and argue back on.
- **Where does the reconciler live?** Flagged in the changeset layer brief; it's genuinely a between-projects question, since it touches every consumer's artifacts.
