---
name: code-review
description: Adaptive, host-neutral code review that routes a change to specialist reviewer lenses and records findings as SARIF
version: 0.0.1
---

# Code Review

Adaptive code review that detects the stack, routes the change to specialist reviewer lenses,
dispatches each as an agent with its own context window, and records findings as SARIF.

## Capabilities

- **Stack-aware routing**: A deterministic detector picks the relevant reviewer lenses for the
  change (language experts + concern lenses), augmented by a bounded semantic step.
- **Lens-based review**: 11 specialist personas (api-design, architecture, cli, code-quality,
  domain-modeling, go, pr-context, ruby, simplicity, tests, typescript), each applied with its
  own focus and severity calibration.
- **Deterministic findings**: Findings are recorded as validated SARIF — line numbers checked
  against real files, severity mapped to SARIF level, suggested fixes encoded as replacements.
  Agents never hand-author JSON.
- **Findings-only and static (v1)**: Reviewers read and report; they do not edit files or run
  build/lint/test.

## Related Files

- `skills/review/SKILL.md` — orchestrator
- `skills/review/resources/lenses/` — reviewer personas
- `skills/review/scripts/` — deterministic routing + findings tools
- `steering/` — Steering files for Kiro
- `mcp.json` — MCP server configuration
