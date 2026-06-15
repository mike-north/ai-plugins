---
name: git
description: Deterministic local-git utilities: exact diff statistics and a stacked-PR manager.
version: 0.0.1
---

# Git Utilities

Deterministic local-git tooling for agents. No GitHub auth required.

## Capabilities

- **Exact diff statistics** (`diff-stats.sh`): meaningful (generated-file-excluded) vs raw
  line counts and an implementation-vs-test split, so PR size is computed, never estimated.
- **Stacked-PR management** (`gst`): create / list / restack / submit / navigate / adopt /
  orphan chains of dependent branches, with stack metadata stored in git config.
- **Worktree discipline** guidance for working a stack.

## Related Files

- `skills/git/SKILL.md` — the tool reference and rules.
- `scripts/` — `diff-stats.sh`, `gst`.
- `mcp.json` — MCP server configuration (none required).
