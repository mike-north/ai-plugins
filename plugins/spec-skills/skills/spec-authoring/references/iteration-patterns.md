# Iteration Patterns

Use this file when refining the skill after real usage.

## Observe Navigation

Watch how the agent uses the skill in practice:

- which reference files it reads first
- which files it never reads
- whether it misses an important reference entirely
- whether it repeatedly depends on one reference file for a core rule

## Adjust Based On Evidence

Use those observations to tune the skill:

- if a critical rule is repeatedly missed, move it closer to the main SKILL.md
- if a reference file is never used, simplify it, rename it, or remove it
- if the agent reads files in a confusing order, make the references more explicit in SKILL.md
- if one file carries too much of the workflow, split or summarize it

## Keep The Core Lean

Only promote content into SKILL.md when repeated evaluations show it is needed for reliable behavior. Keep detailed examples and secondary guidance in references.
