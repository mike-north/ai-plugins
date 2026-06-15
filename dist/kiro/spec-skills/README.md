# spec-skills

A Claude Code plugin providing two model-invoked skills for working with software specifications.

## Skills

- **spec-audit** — Compare an implementation, test suite, generated artifact, or behavior description against a governing specification. Classify gaps (aligned, divergent, specified but missing, insufficiently tested, spec ambiguity) and recommend the smallest correct follow-up.
- **spec-authoring** — Draft, revise, or clarify thorough software specifications: design docs, architecture specs, requirements documents, protocol/schema specs, ADRs, and implementation-guiding technical docs. Enforces explicit scope, non-goals, examples, and validation criteria.

Both skills are auto-invoked by Claude when a task matches their description. No slash commands are registered.

## Install (local)

```
/plugin install ~/.claude/plugin-dev/spec-skills
```

Then start a fresh session and verify `spec-audit` and `spec-authoring` appear in the available-skills list.

## Source of truth

Skill content is ported from the Codex originals at:

- `~/.codex/skills/spec-audit/`
- `~/.codex/skills/spec-authoring/`

When updating skill guidance, edit the Codex originals first, then mirror the changes here. Only the SKILL.md frontmatter description is adapted for Claude Code's trigger dispatcher; reference files are verbatim copies.
