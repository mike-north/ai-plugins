# Skill Evals

Use this checklist when refining the skill.

## Minimum Eval Set

Run at least one audit from each category:

1. code vs explicit spec
2. tests vs expected artifacts
3. implementation vs a draft spec that may be ahead of reality
4. ambiguity detection where the governing sources conflict

## What Good Looks Like

- the audit identifies the correct governing sources
- findings are evidence-backed and section-specific
- classification is explicit and justified
- missing coverage is called out separately from implementation drift
- ambiguity is reported as ambiguity rather than converted into fake certainty

## Failure Signals

- findings without a spec citation
- implementation critique that ignores project conventions
- no distinction between divergence and missing coverage
- silent reliance on superseded documents
- treating style nits as the main result of the audit

## Refinement Rule

Prefer evaluation-driven refinement over adding more prose by default:

1. run representative audits with the current skill
2. capture where the agent chose the wrong governing sources, missed evidence, or misclassified a gap
3. add the smallest instruction or reference that addresses the observed failure
4. rerun the same audits and compare results
