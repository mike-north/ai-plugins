# The crystallization flow (draft)

> **Status**: draft — becomes governing when merged. Governing brief:
> [the judge](../harness-program/judge.md) §"Intents, and the ratchet" and §"Decisions,
> staged and ratified".

The judge is a **discovery mechanism, not a permanent runtime gate**. It starts on the
reasoning path because the violating pathways are unknown; every real attempt it catches
becomes a candidate for a rigid, deterministic rule. The reasoning surface shrinks as
coverage accumulates; the expensive judge is left working the residual long tail.

## The flow

```
caught attempt (adjudication, M2)
      │
      ▼
ruling — cites intent article(s), fills the risk template
      │
      ▼
signed changeset — via the ratification porcelain (`ratify propose`):
  template filled, sealed by the judge's key, PR opened. Never hand-rolled.
      │
      ▼
human merge to the config monorepo's `main` — THE ratification event
      │
      ▼
reconciler applies merged `main` → steering rule live
  (ratification's one applier, per-package apply manifests — D-010)
```

Stage by stage, with owners:

1. **Ruling.** The judge's output: verdict + direction, the governed command shape, the
   intent citation, the triggering observation, and the risk-template body
   ([risk-vocabulary](./risk-vocabulary.md),
   [identity-and-enrollment](./identity-and-enrollment.md) §"The risk template"). Purely
   the judge's.
2. **Proposal.** The judge invokes the ratification layer's porcelain tool
   ([porcelain-tool](../ratification/porcelain-tool.md)); the tool owns all mechanics —
   frontmatter fill, matcher-version stamping, sealing via attest-it, PR opening. The judge
   supplies the decision, never touches crypto or the file format.
3. **Ratification.** A human merge. CI green is only permission to merge
   ([ci-validation-contract](../ratification/ci-validation-contract.md)); nothing
   auto-merges. Tightening changesets may be judge-authored end-to-end; **loosening
   changesets only take effect through this human act** — the judge's signature on them
   attests authorship, never safety.
4. **Application.** Ratification's reconciler — never a judge-owned puller
   ([D-010](../harness-program/DECISIONS.md)).

**While unpromoted, the judge keeps enforcing its decision on the reasoning path** —
re-ruling the same shape at each encounter. Ratification is what retires that recurring
cost; the staged decision is never silently live.

## The shape-lookup ("have I ruled on this shape?")

Before reasoning, a deterministic lookup: does a live ratified changeset's
`commandPattern` cover this command? Binding rules, per
[D-011](../harness-program/DECISIONS.md):

- Matching uses **command-steering's one matcher**, consumed by version — the same matcher
  that evaluates `covers` at runtime. The judge never implements matching.
- Each changeset pins `commandPattern.matcherVersion`. A pinned version the local matcher
  cannot satisfy (per steering's compatibility contract, their #95 Part A) **fails closed**:
  the judge does not apply the ruling, and the command degrades to the normal flow. A
  matcher bump never silently re-matches an old ruling.
- Cheap deterministic lookup first; expensive reasoning only on a miss (the
  frontmatter-schema's governing principle, shared).

## The crystallized-memory read path

**The judge reads ratified `main` of the config monorepo — only.** Unmerged proposals
(branches, open PRs) are never part of crystallized memory: a proposal the judge itself
made yesterday has no more authority than one it would make today, until a human merges it.

Consequence (the judge line's answer to the schema's `ratificationStatus` question): since
everything the judge can see is by construction ratified, **merge-to-`main` is the
authoritative ratified state and the `ratificationStatus` field is advisory** — useful for
marking `proposed` on branches and for cheap filtering, but no consumer may treat the field
as authoritative over git state, and the reconciler is not required to stamp it.

## Learning-direction asymmetry

Crystallization inherits the [triage-policy](./triage-policy.md) trust asymmetry:

- **Tightening rules** (deny/redirect) may crystallize from the judge's own catches,
  unilaterally proposed, human-merged as a matter of course.
- **Allow-direction rules** crystallize only from legible human feedback — an approval with
  a stated reason — with the full provenance trail in the frontmatter. Never from bare
  approval counts, never automatically.

## Non-goals

- The changeset file format, header schema, CI checks, reconciler: ratification's.
- Matcher semantics and versioning: steering's.
- The adjudication runtime itself: M2-gated; nothing in this document authorizes running it.
