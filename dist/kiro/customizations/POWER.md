---
name: customizations
description: Route any agent-customization need to the right primitive — script, memory, rule, hook, skill, agent, MCP, monitor, plugin, or marketplace — determinism-first, authoring the light ones and delegating the rest.
version: 0.0.1
---

# Customizations

A **router** for agent customization. It turns "make my agent reliably do / stop / remember / sense /
react to X" into the *right* primitive at the *right* scope — then authors the light ones directly and
delegates the heavy ones to authoritative tools, installing them on demand.

## Capabilities

- **Determinism-first triage**: route a need to the right primitive (script · memory · rule · hook ·
  skill · agent · MCP · monitor · plugin · marketplace), pushing work into deterministic mechanisms
  and cheaper model tiers before spending premium reasoning.
- **Light authoring + delegation**: author scripts/memory/rules directly; delegate skills, agents,
  MCP, monitors, plugins, and marketplaces to their authoritative tools.
- **Chaining**: neutralize expensive/noisy sources (e.g. extractor script → monitor) so the agent is
  woken only on a confirmed, relevant signal.
- **Provenance-aware**: personal overrides for consumed marketplace content; edits + PRs for content
  you maintain.
- **Routing evals**: a structured, deterministically-scored eval set to prove the routing works and
  keeps improving.

## Related Files

- `skills/customizations/SKILL.md` — the routing brain
- `skills/customizations/reference/` — triage table, delegation, provenance, chaining, manifest schema, per-type authoring pointers
- `skills/customizations/scripts/manifest.mjs` — deterministic bookkeeping for tracked customizations
- `evals/` — the routing eval set + deterministic scorer
- `steering/` — steering files for Kiro
- `mcp.json` — MCP server configuration (none)
