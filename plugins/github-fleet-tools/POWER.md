---
name: github-fleet-tools
description: Opinionated, allowlistable command-line tools for an agent to engage with GitHub.
version: 0.0.1
---

# GitHub Fleet Tools

A deterministic, opinionated tool surface for letting an agent engage with GitHub safely
and autonomously. Each tool wraps exactly one `gh` operation with no arbitrary-API escape
hatch, so it can be allowlisted and run without a prompt — while raw `gh api` stays gated.

## Capabilities

- **Read-only inspection**: `pr-status.sh` (CI + merge state + unresolved review threads),
  `gh-queue.mjs` (ranked issue work queue + ground-truth claim check), `pr-thread-status.sh`,
  `pr-review-comment-count.sh`.
- **Bounded write verbs**: label, comment, reply-to/resolve review threads, create issue/PR,
  mark a PR ready — one `gh` mutation per script, validated inputs, no arbitrary API.
- **Guarded merge**: `pr-merge.sh` squash-merges only when the PR is open, non-draft, not a
  release/Version PR, has a reviewer review present, and has passed required checks.

## Related Files

- `skills/github-fleet-tools/SKILL.md` — the tool reference, doctrine, and setup/allowlisting.
- `skills/github-fleet-tools/scripts/` — the bounded `gh`-wrapping scripts.
- `mcp.json` — MCP server configuration (none required).

Requires `git` and an authenticated GitHub CLI (`gh`).
