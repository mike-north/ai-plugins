---
name: product-led-eng-fleet
description: Run a product-led engineering fleet over a GitHub-issue work queue.
version: 0.0.1
---

# Product-led Eng Fleet

A reusable operating model for running software delivery as a fleet of autonomous coding
agents coordinated through a GitHub-issue work queue.

## Capabilities

- **Deterministic queue engine**: `gh-queue` (from the companion `github-fleet-tools` plugin)
  lists the ranked ready queue and runs a "who has what" ground-truth check — over git and the
  GitHub CLI, never by reasoning over issues in context.
- **Bounded GitHub write-tools**: bounded verbs (`gh-label`, `gh-reviews reply`/`resolve`,
  guarded `gh-merge`) plus `gh`-native verbs (`gh issue comment`/`create`/`close`,
  `gh pr comment`/`ready`/`create`), so each is allowlistable and runs autonomously while raw
  `gh api` stays human-gated.
- **Orchestrator loop**: triages the queue, claims issues, delegates to implementer
  sub-agents, monitors each PR by number, drives the review/fix cycle, and merges + closes.
- **Fleet conventions as standing rules**: acceptance-criteria-as-contract, `Refs #N` not
  `Closes #N`, implementers stop at PR-open, format before every push, never touch
  release/Version PRs.

## Related Files

- `skills/product-led-eng-fleet/SKILL.md` — the operating model and routing.
- `steering/fleet-conventions.md` — always-on steering summary for Kiro.
- the `github-fleet-tools` plugin — the companion bounded GitHub scripts (detection + writes).
- `mcp.json` — MCP server configuration (none required).
