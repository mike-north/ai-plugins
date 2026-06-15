# Iteration Patterns

Use this file when refining the skill after real audit sessions.

## Observe Navigation

Watch how the agent uses the skill in practice:

- which references it reads before writing findings
- whether it misses the evidence or classification guidance
- whether it ignores a project-adaptation step and jumps straight into code review
- whether it overuses one reference that should probably be summarized in SKILL.md

## Adjust Based On Evidence

Use those observations to tune the skill:

- if governing-source selection is weak, make that rule more prominent in SKILL.md
- if findings are poorly structured, strengthen the evidence format guidance
- if the agent misses regression boundaries, move that rule earlier or phrase it more explicitly
- if a reference is unused, simplify, rename, or remove it

## Keep The Core Lean

Only promote content into SKILL.md when repeated audits show it is needed for reliable behavior. Keep detailed examples and secondary guidance in references.
