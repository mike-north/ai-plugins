# Code Review

Adaptive, host-neutral code review. Detects the project's stack, routes the change through
specialist reviewer **lenses**, dispatches each as an agent with its own context window, and
records findings — plus mechanical fixes captured straight from real worktree edits — as
[SARIF](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html). Publishing to GitHub
is a separate, explicit step.

## Three skills

1. **`workspace`** — creates an isolated git worktree for a PR or feature branch, bootstraps its
   dependencies, and switches the session into it. Review never runs against the user's own
   checkout when reviewing someone else's PR.
2. **`review`** — the orchestrator. Collects deterministic facts about the change
   (`scripts/signals.mjs`), routes them through a lens/pack catalog (`scripts/route-lenses.mjs`),
   dispatches one subagent per rostered lens, merges their findings
   (`scripts/merge-findings.mjs`), and renders a report (`scripts/render-review.mjs`). Findings
   only — it never posts to GitHub.
3. **`publish-pr`** — takes a completed review's merged SARIF and posts it as one **PENDING**
   GitHub review (`scripts/post-review.mjs`). A human submits it; this skill never does.

Two principles hold the design together:

- **Mechanical work lives in deterministic code.** Reviewer agents only judge *whether*
  something is a problem, *why* it matters, and — for a clear-cut case — make the actual edit.
  Snapshotting, diffing, building SARIF, deduping across reviewers, and rendering reports are all
  done by the scripts in `skills/review/scripts/`, never hand-assembled by an agent.
- **A suggested fix is a real edit, not markdown.** Reviewers never write a ` ```suggestion `
  fence by hand.

## The fix protocol: edit → snapshot capture → suggestion fence

When a reviewer finds something with an obvious, safe fix, it edits the file in the worktree
directly, then calls `record-finding.mjs --fix-from-worktree`. That call:

1. Snapshots the worktree's current state as a git commit pinned to a ref (no working-tree files
   touched), scoped to this review session.
2. Diffs that snapshot against the previous one to isolate exactly the hunks that appeared *since
   the last capture* — snapshot subtraction — and attributes them to the finding being recorded.
3. Converts those hunks into a SARIF `fixes[0]` (a real, validated replacement region), not prose.

Two reviewers editing overlapping regions is detected as drift (exit 4) and must be resolved with
`--amend <findingId>` (merge into the finding that already owns that region) rather than silently
overwritten. Later, `post-review.mjs` turns each fix into a live ` ```suggestion ` fence anchored
to the PR's actual diff — the agent never authors that markdown itself.

## SARIF interchange

Every reviewer writes one `findings/<reviewer>.sarif.json` (minimal SARIF 2.1.0) into the review's
work area. `merge-findings.mjs` combines them: it asserts every log agrees on the same baseline
revision (exit 4 if HEAD moved underneath the review), checks that every worktree edit is
attributed to some finding (the "partition check" — an unattributed edit is also exit 4, unless
`--allow-unattributed` demotes it to its own finding), deduplicates near-identical findings across
reviewers (folding corroborating reviewers into one, bumping confidence), and caps how many
findings can be inline before the rest are demoted to a summary. The result,
`merged.sarif.json`, is the one artifact both `render-review.mjs` and `post-review.mjs` consume —
neither reimplements any of the above.

## The lens/pack catalog

`skills/review/lenses/*.md` are the reviewer personas — nine lenses covering general code
quality, tests, TypeScript, Rust, Go, Ruby, CLI UX, API design, and architecture/domain modeling.
Each lens's YAML frontmatter is also its routing rule:

```yaml
lens: typescript
description: One-line summary shown to the orchestrator.
charter: >
  The one sentence naming the finding classes this lens uniquely owns.
route: always | auto | judgment    # always-run, file/dep-triggered, or LLM-judged
match:                              # auto only — OR-list of AND-predicate objects
  - { ext: "ts,tsx,mts,cts" }
miss_cost: high | low               # cost of NOT running this lens when it should have
packs:                              # extra domain-fact files loaded into this lens's prompt
  - { id: "eslint-rule-authoring", when: { dep: "@typescript-eslint/utils" } }
```

`route-lenses.mjs` resolves this against `signals.mjs`'s facts into a roster — deterministically,
no LLM call. `skills/review/packs/*.md` hold the actual domain facts (framework pitfalls, spec
gotchas), each carrying `verified`/`sources`/`verify` frontmatter so staleness is checkable rather
than assumed. `scripts/catalog-lint.mjs` validates the whole catalog's structural invariants
(required fields, word limits, every `packs:` reference resolving, every lens fencing off its
neighbors) — run it after editing any lens or pack.

## Status

Findings-and-fixes-capable, not yet self-posting by default: `review` produces findings and
mechanical fixes; `publish-pr` posts them as a pending review a human must submit. See each
skill's `SKILL.md` for the exact flow and exit-code contracts.

## License

ISC
