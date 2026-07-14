# Skill Evals

Use this checklist when refining the skill.

## Minimum Eval Set

Run at least one task from each category:

1. draft a new spec for an unfamiliar project
2. revise an existing spec in a mature docs ecosystem
3. clarify an ambiguity without overreaching
4. add expected artifacts or tests to a previously vague section

## What Good Looks Like

- the agent identifies governing sources early
- the deliverable shape is explicit
- examples are concrete and say what they prove
- assumptions are labeled instead of hidden
- the resulting document can plausibly drive implementation or tests

## Failure Signals

- generic design-doc boilerplate
- no clear scope boundary
- no examples for tricky behavior
- unsupported certainty where sources are ambiguous
- no testing or validation implications

## Refinement Rule

Prefer evaluation-driven refinement over adding more prose by default:

1. run representative tasks without changing the skill
2. record specific failures, omissions, or weak outputs
3. add the smallest instruction or reference that addresses the observed gap
4. rerun the same tasks and compare behavior
