---
name: spec-skills
description: Model-invoked skills for auditing implementations against a governing spec and for authoring thorough, testable specifications
version: 0.0.1
---

# Spec Skills

Two model-invoked skills for working with software specifications.

## Capabilities

- **spec-audit**: Compare an implementation, test suite, generated artifact,
  pull request, or migration against a governing specification; classify gaps by
  evidence; flag broken invariants and non-goals; surface ambiguity or
  contradiction in the governing documents.
- **spec-authoring**: Draft or revise thorough, testable specifications — design
  docs, architecture specs, requirements, protocol/schema definitions, and
  ADR-style decisions — with explicit scope, invariants, examples, non-goals,
  edge cases, and validation criteria.

## Related Files

- `skills/spec-audit/` and `skills/spec-authoring/` — the skills and their
  `references/` (eval cases, scorecards, workflows, project adaptation)
- `steering/` — Steering files for Kiro
- `mcp.json` — MCP server configuration
