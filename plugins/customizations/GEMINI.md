# Customizations

A **router** for agent customization. Describe how you want the agent to behave and it routes the need
to the right **primitive** — `script`, `memory`, `rule`, `hook`, `skill`, `agent`, `mcp`, `monitor`,
`plugin`, or `marketplace` — at the right scope, authoring the light ones and delegating the heavy
ones to authoritative tools.

## Doctrine

Right-size the resource: prefer **deterministic mechanisms** over model reasoning, and the **cheapest
model tier** that clears the reliability bar. Don't make the agent a polling/diffing loop; push
detection into scripts/hooks/monitors and reason only on a confirmed signal.

## Overview

- The `customizations` skill is the routing brain; `reference/` holds the triage table, delegation
  map, provenance rules, chaining recipes, and per-type authoring pointers (read fresh, never copied).
- `evals/` ships a structured routing eval set + deterministic scorer to validate and iterate on the
  routing.
- Heavy authoring delegates (skill-creator, agentmonitors, marketplace-authoring/aipm, …) are
  installed on demand with your confirmation; their executables run immediately via `npx`.
