# GitHub Fleet Tools

A deterministic, opinionated tool surface for letting an agent engage with GitHub safely
and autonomously. Five consolidated CLI tools cover the small, fixed set of operations a
coordinating agent needs; each custom tool is compound, API-only, guarded, or
permission-scopable — never a bare shadow of a `gh` porcelain command — so it can be
allowlisted and run without a prompt, while raw `gh api` stays gated.

## Capabilities

- **`gh-reviews <status|threads|count|reply|resolve>`** — PR review-thread inspection
  (CI rollup, merge state, unresolved threads, per-thread/reply status, inline-comment
  counts) plus the API-only reply/resolve mutations.
- **`gh-queue <list|ground-truth N|status>`** — read-only issue work queue: ranked ready
  queue + ground-truth claim check + rollup.
- **`gh-repo <file|compare>`** — read a file at a ref, or list a compare range's changed
  files + stats, via the API with no local checkout.
- **`gh-label <N> add|remove <LABEL>`** — bounded single-label edit, the granular affordance
  over broad `gh issue edit`.
- **`gh-merge <N> [--dry-run]`** — guarded squash-merge: merges only when the PR is open,
  non-draft, not a release/Version PR, has a reviewer review present, and has passed required
  checks.

Six operations were intentionally dropped to `gh`-native verbs (`gh issue comment`/`close`/
`create`, `gh pr comment`/`ready`/`create`).

## Related Files

- `skills/github-fleet-tools/SKILL.md` — the tool reference, the rubric, and setup/allowlisting.
- `scripts/` — the five consolidated `gh`/API tools.
- `mcp.json` — MCP server configuration (none required).

Requires `git` and an authenticated GitHub CLI (`gh`).
