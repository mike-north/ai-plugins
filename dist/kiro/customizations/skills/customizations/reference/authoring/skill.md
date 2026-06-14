# Authoring a skill (delegate to skill-creator)

A skill is a **packaged unit of expertise**: judgment-bearing know-how that can bundle its own
hooks + `resources/`, be **toggled per session / scoped to subagents**, and be **user- vs
agent-invocable**. Prefer **extending an existing skill** over adding a granular new one (too many
skills muddy semantic activation).

## Delegate to the authoritative source

`anthropic-skills:skill-creator` is the authority on **what makes a good skill** — structure,
progressive disclosure, and especially the **description written to trigger precisely**. Read it
fresh: `https://github.com/anthropics/skills/tree/main/skills/skill-creator`. It also ships **eval
tooling** (a trigger-rate optimizer and an output benchmark) — use it to validate and tune the skill's
description, not just to write it. Install on demand if absent (`npx skills add anthropics/skills`).

## Apply the doctrine while authoring

- **Arm it with scripts (Axis 1).** Before finishing, ask "what mechanical work can become a
  deterministic helper this skill calls?" Co-produce those scripts; record them as components of the
  *same* customization.
- **Cheaper tier (Axis 2).** Could the procedure run on a cheaper model? If so, note it / route it.
- **Context-window hygiene.** For a large skill, keep the entry point small and **route to
  `resources/*.md` conditionally** (nested activation) rather than front-loading everything.
- **Invocation control.** Make it user-only when you want a shortcut but want to dissuade autonomous
  use (e.g. "merge a PR").

## Provenance

If you'd be modifying an *imported* skill, apply `../provenance.md` first: a `consumer`-marketplace
skill gets a **personal override**, never an in-place edit.
