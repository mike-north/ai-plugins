---
name: project-room-preparation
description: Organize messy project sources into an inspectable "project room" before drafting a high-stakes deliverable
version: 0.0.1
---

# Project Room Preparation

Turn a messy pile of project sources into an inspectable, trustworthy "project
room" before any drafting begins.

## Capabilities

- **Source inventory & audit**: Catalog every source, what it is, and what it
  can be trusted to support.
- **Duplicate & conflict logs**: Surface redundant sources and contradictions
  that must be resolved before writing.
- **Missing-context list**: Make explicit what's absent so gaps are filled
  deliberately, not papered over.
- **Working brief**: Distill the prepared room into a grounded brief that a
  draft can be written against.
- **Grounded draft & refresh**: Draft only from the clean room, and refresh the
  room as sources change.

## Workflow

Four orchestrated prompts under `skills/project-room-preparation/references/`:
room builder, source inventory & audit, grounded draft, and project room
refresh.

## Related Files

- `skills/project-room-preparation/` — the skill and its `references/`
- `steering/` — Steering files for Kiro
- `mcp.json` — MCP server configuration
