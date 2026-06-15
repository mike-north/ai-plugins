# Eval Workflow

Use this file when evaluating or refining `$spec-authoring`.

## Core Loop

1. run a small set of representative authoring tasks
2. review outputs qualitatively with the scorecard
3. note repeated failures or omissions
4. make the smallest skill change that addresses the observed problem
5. rerun the same tasks
6. expand the eval set only after the small set is stable

## Two Eval Types

Keep these distinct:

- task-quality evals
  - does the skill produce strong specs on representative prompts
- trigger evals
  - does the skill description trigger on the right user requests and stay out of the wrong ones

Do not treat a good task-quality run as proof that triggering is accurate.

## Task-Quality Guidance

- use fresh threads when possible
- do not reveal the expected answer to the evaluating agent
- prefer realistic prompts with repo context, file paths, and concrete goals
- capture what the agent read before writing

## Trigger Guidance

- use realistic should-trigger and should-not-trigger queries
- include casual phrasing, typos, and indirect requests
- update the skill description if undertriggering or overtriggering is a recurring problem

## Expansion Rule

Once the initial cases are stable, add harder or more varied prompts:

- sparse-doc repos
- mature spec ecosystems
- narrow clarification patches
- tasks with migration or compatibility constraints
