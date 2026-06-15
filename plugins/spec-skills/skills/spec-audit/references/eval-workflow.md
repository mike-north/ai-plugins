# Eval Workflow

Use this file when evaluating or refining `$spec-audit`.

## Core Loop

1. run a small set of representative audit tasks
2. review outputs qualitatively with the scorecard
3. note misclassifications, missed evidence, or weak governing-source selection
4. make the smallest skill change that addresses the observed problem
5. rerun the same tasks
6. expand the eval set only after the small set is stable

## Two Eval Types

Keep these distinct:

- task-quality evals
  - does the skill produce strong spec-alignment audits on representative prompts
- trigger evals
  - does the skill description trigger on the right user requests and stay out of the wrong ones

Do not assume good audit quality implies good triggering.

## Task-Quality Guidance

- use fresh threads when possible
- do not reveal expected findings to the evaluating agent
- prefer realistic prompts with file paths, specific docs, and concrete audit targets
- record what sources the agent treated as authoritative

## Trigger Guidance

- use realistic should-trigger and should-not-trigger queries
- include indirect language such as "does this actually match the spec" or "are we compliant with the design doc"
- tighten the description if it overtriggers on generic code review or undertriggers on spec-alignment questions

## Expansion Rule

Once the initial cases are stable, add harder or more varied prompts:

- superseded decisions
- migration and compatibility audits
- diagnostics or structured-output audits
- underdefined spec detection
