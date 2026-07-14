# Filing pickup-ready issues (the PM side)

Issues are the only PM→eng interface. A vague issue produces vague autonomous work, and
anything not filed as an issue never gets picked up. The implementer that takes your issue
has **no conversation context** — the issue must stand entirely on its own.

## A pickup-ready issue contains

- **Problem** — what's wrong or missing, and why it matters now. One or two sentences.
- **Governing references** — links to the spec sections / docs / prior art that constrain
  the solution, so the implementer doesn't reinvent or contradict intent.
- **Acceptance criteria** — concrete, testable statements. These _are_ the contract; the
  implementer maps each to a named test. Prefer "X returns Y when Z" over "X works."
- **Non-goals** — what's explicitly out of scope, so the change stays reviewable.
- **Proof** — how to demonstrate it's done (the test or observable behavior).

## Sizing and hygiene

- **One issue ≈ one agent's unit of work.** Split separable tracks into separate issues;
  don't bundle (bundled issues serialize work that could run in parallel).
- **Don't file work that needs credentials only a human has** (publish 2FA, registrar DNS,
  repo secrets) — surface those directly to the human instead.
- **Mark undecided work, don't queue it.** If a design choice is unresolved, label the issue
  `needs-decision` (or your repo's equivalent) so the fleet skips it until you resolve it.
  Deferred-but-decided work gets `backlog`. The ready queue is for greenlit, decided work.
- **Rank with the title and labels, not prose.** Put real deadlines in the title
  (`… (due YYYY-MM-DD)`) and priority labels on the issue — `gh-queue list` ranks on
  exactly those signals.

## Filing it

Create the issue with `gh issue create`, passing the body as a file so multi-line Markdown
survives intact:

```
gh issue create --title "Spec: rollup pace mode (due 2026-06-18)" \
    --body-file ./draft.md --label P1 --label spec
```

`gh issue create` is allowlisted directly (a scoped `gh`-native verb), so it runs without a prompt.

## Maintaining the conventions channel

The fleet-conventions doc (e.g. `ENG_TEAM_INSTRUCTIONS.md`) is the PM's standing channel to
the fleet. When a working-convention friction recurs across PRs (review races, closing-
keyword mistakes, stale claims), encode the fix there once rather than correcting it per-PR.
Keep it ~one page; every rule should trace to a real failure mode.
