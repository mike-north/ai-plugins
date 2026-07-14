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
  refuses unless the PR is open, non-draft, not a release/Version PR, has a reviewer review
  present, and has passed required checks.

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
rules. All tools honor `GH` / `GH_HOST` and require `git` + an authenticated `gh`.

## License

ISC
