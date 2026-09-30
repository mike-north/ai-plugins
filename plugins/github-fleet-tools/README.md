# GitHub Fleet Tools

An opinionated, **allowlistable** command-line tool surface for letting an agent engage with
GitHub safely and autonomously. Five consolidated CLI tools cover the small, fixed set of
operations a coordinating agent actually needs — each justified by a strict rubric (below),
with everything that would merely shadow a `gh` porcelain command deleted in favor of the
native verb.

This is the *tooling* layer; the *methodology* that drives these into a PM/orchestrator loop is
the **product-led-eng-fleet** plugin, which depends on this one.

## Tools

- **`gh-reviews <status|threads|count|reply|resolve>`** — PR review-thread inspection plus the
  API-only reply/resolve mutations. `status` = CI rollup + merge state + unresolved threads;
  `threads` = per-thread resolved/reply status (exit 2 = needs action); `count` = inline
  review-comment + resolved/unresolved counts; `reply` = reply to + resolve one thread;
  `resolve` = resolve every unresolved thread (`--dry-run` first).
- **`gh-queue <list|ground-truth N|status>`** — read-only issue work-queue engine: ranked
  ready queue + "safe to claim?" ground-truth check + rollup.
- **`gh-repo <file|compare>`** — read a file at a ref (`file <ref> <path>`) or list a compare
  range's changed files + stats (`compare <base>...<head>`), via the API, no local checkout.
- **`gh-label <N> add|remove <LABEL>`** — bounded single-label edit (claim / release), the
  granular affordance over broad `gh issue edit`.
- **`gh-merge <N> [--dry-run]`** — guarded squash-merge; **prompts** (configured as `ask`) and
  refuses unless the PR is open, non-draft, not a release/Version PR, has a recognisably
  completed reviewer review, has passed required checks, and that review is **fresh**.
  A review is fresh if it was on the head, or if every later edit is one of:
  - a rebase;
  - in a path the repository exempts in a committed `.github/gh-merge.json`;
  - an answer to the reviewer's own feedback that goes no further (judged per hunk by
    TypeSafe's Jev model).

  The gate fails closed: an unverifiable guard refuses. It needs `TYPESAFE_API_KEY` in the
  environment when edits must be judged. See
  `skills/github-fleet-tools/references/review-freshness.md`.

## The rubric (why these five)

A custom tool here is justified **only** if it is at least one of:

1. **Compound** — collapses several `gh` calls / a GraphQL query into one token-efficient result.
2. **Missing** — no `gh` porcelain exists; API-only.
3. **Guarded** — a safety wrapper enforcing preconditions around a `gh` command.
4. **Permission-scopable** — the bounded op can't be cleanly allow-listed off a broader `gh`
   command in target harnesses.

Six operations were **intentionally dropped** in favor of `gh`-native commands (no custom
wrapper): `gh issue comment`, `gh issue close`, `gh issue create`, `gh pr comment`,
`gh pr ready`, `gh pr create`.

## Setup

Tools are in `skills/github-fleet-tools/scripts/` (extensionless, executable). Call them by path
(`${CLAUDE_PLUGIN_ROOT}/skills/github-fleet-tools/scripts/<name>`) or — recommended — symlink them onto your `PATH`
(e.g. `~/bin`) and call them by name, which gives stable allowlist entries independent of the
install path:

```bash
ln -sf "$PLUGIN/scripts/"* ~/bin/    # then `gh-queue list`, `gh-merge 10`, …
```

Allowlist the read tools, the gh-native verbs, and the bounded write tools; leave `gh-merge`
and raw `gh api` as `ask`. Note that `gh issue edit` is deliberately **not** allowlisted —
label edits go through `gh-label`. See `skills/github-fleet-tools/SKILL.md` for the exact
rules. All tools honor `GH` / `GH_HOST` and require `git` + an authenticated `gh`; `gh-merge`
also needs `node` and, when judging post-review edits, `TYPESAFE_API_KEY` (provide it through
the agent's environment, e.g. a secrets launcher — the tool never calls a secrets manager).

## License

ISC
