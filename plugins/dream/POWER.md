---
name: dream
description: Periodic memory consolidation and self-improvement — "dream"
version: 0.0.1
---

# Dream

Periodic **memory consolidation and self-improvement**, modeled on sleep. Once per
interval (default 24h), the `dream` skill reviews recent sessions, consolidates the
memory store (one fact per file), reconciles and prunes it, and surfaces recurring
friction as **proposed** customizations to review.

## Capabilities

- **Memory consolidation**: merge duplicates, convert relative dates to absolute,
  reconcile contradictions, prune stale facts — into a one-fact-per-file store with a
  synced index.
- **Signal gathering**: deterministically mine recent transcripts for durable facts,
  corrections, and preferences.
- **Customization proposals**: turn recurring friction into `proposed` customizations
  (reviewed via the `customizations` plugin) — never self-authored.
- **Deterministic scheduling**: a zero-dependency script owns the 24h gate; the agent
  never computes elapsed time.

## Auto-dream (session start)

Kiro loads `steering/auto-dream.md` automatically: at session start it checks
`/dream check` and runs a full `/dream` when one is due. Where hooks exist, a
session-end hook pre-queues a due dream.

## Related Files

- `skills/dream/SKILL.md` — the four-phase dream procedure
- `skills/dream/scripts/should-dream.mjs` — the deterministic 24h gate
- `steering/auto-dream.md` — the session-start trigger
- `mcp.json` — MCP server configuration (none)
