---
name: spec-audit
description: Use when auditing an implementation, test suite, generated artifact, pull request, migration, or behavior description against a governing specification in any project. Activate when the task mentions whether behavior matches the spec, whether coverage proves it, whether a change broke an invariant or non-goal, or whether ambiguity or contradiction in the governing documents is blocking a confident judgment.
---

# Spec Audit

## Establish The Audit

- Identify the audit target: code, tests, generated outputs, behavior, or a pull request.
- Identify the governing spec sources before inspecting implementation details.
- State the expected deliverable shape up front.
- If one missing fact is blocking a correct audit boundary, ask one narrow question. Otherwise proceed with bounded assumptions and label them.

## Decide What Governs

- Separate normative sources from informative ones.
- Read current decision logs, changelogs, or superseding notes before treating an older document as authoritative.
- Use examples, expected outputs, fixtures, and comparison helpers as part of the governing contract when the project treats them as such.
- Preserve the distinction between current behavior, target behavior, and future ideas.

## Adapt To The Current Project

- Learn the repository's spec style before judging divergence.
- Map the feature to the likely code, tests, and generated artifacts that should embody the requirement.
- If the repo has multiple overlapping documents, build a short traceability map instead of trusting the nearest single document.

## Audit Behavior, Not Cosmetics

- Compare semantic behavior, externally visible outputs, diagnostics, and invariants before caring about internal organization.
- Treat a different implementation structure as acceptable if the specified behavior still holds.
- Prefer checking the spec's own examples and expected artifacts before inventing new interpretations.
- Check whether preserved behavior or non-goals were accidentally violated by the implementation.

## Classify Findings Explicitly

- Use these buckets:
  - aligned
  - divergent
  - specified but missing
  - insufficiently tested
  - spec ambiguity or contradiction
- When the implementation and spec disagree, recommend the smallest correct follow-up:
  - code change
  - test change
  - spec change
  - decision-log or changelog update

## Keep Findings High Signal

- Cite the spec source and the implementation evidence together.
- State the expected behavior, observed behavior, and why the gap matters.
- Prefer findings about semantic mismatches, missing coverage, wrong output shapes, incorrect diagnostics, broken invariants, or drift from preserved behavior.
- Treat style-only comments as secondary unless they obscure a normative requirement.
- If no gap is found, say what was checked and what remains unverified.

## Use A Practical Output Shape

- Prefer one finding per mismatch with:
  - spec
  - implementation evidence
  - impact
  - follow-up
- If the audit is broad, add a short coverage summary first:
  - what sources governed
  - what areas were inspected
  - what was not fully verified

## Preserve Traceability And Regression Boundaries

- Use requirement-to-design-to-validation traceability when deciding whether a behavior is actually missing.
- Treat preserved behavior and regression risk as first-class audit topics.
- Check whether upstream spec changes were reflected in downstream tests and artifacts.
- Do not manufacture a failure when the real issue is that the spec is underdefined.

## Use Bundled References

- Read `references/project-adaptation.md` before auditing in an unfamiliar repository.
- Read `references/evidence-and-classification.md` for finding structure and classification rules.
- Read `references/example-projects.md` for cross-project exemplars, including FormSpec as a strong audit corpus.
- Read `references/traceability-and-regression.md` for distilled guidance on following requirements through implementation and tests.
- Read `references/eval-workflow.md` when setting up repeatable qualitative and trigger evals.
- Read `references/eval-cases.md` and `references/eval-scorecard.md` when running repeatable forward-tests.
- Read `references/trigger-evals.json` when checking whether the description triggers in the right cases.
- Read `references/iteration-patterns.md` when refining the skill based on real audit sessions.
- Read `references/skill-evals.md` when refining or forward-testing the skill.
