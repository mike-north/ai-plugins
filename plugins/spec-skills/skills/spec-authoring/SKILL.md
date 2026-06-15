---
name: spec-authoring
description: Use when drafting, revising, or clarifying thorough software specifications for any project — design docs, architecture specs, requirements documents, protocol or schema specifications, ADR-style technical decisions, or implementation-guiding technical docs. Activate when the task mentions scope, invariants, expected outputs, validation criteria, non-goals, edge cases, migration concerns, or making a vague design more explicit and testable.
---

# Spec Authoring

## Establish The Job

- Identify the task as `draft`, `revise`, `clarify`, or `gap-fill`.
- State the target artifact before deep work: document, section, feature area, protocol, schema, or workflow.
- State the expected deliverable shape up front.
- If one missing fact is genuinely blocking correctness, ask one narrow question. Otherwise proceed with bounded assumptions and label them explicitly.

## Adapt To The Current Project

- Inspect the project's existing specifications, architecture docs, RFCs, ADRs, or design notes before writing.
- Reuse the project's preferred terms, section names, and evidence style instead of importing a generic template unchanged.
- Identify governing sources first: root principles, prior decisions, changelogs, issue discussions, tests, and existing generated artifacts.
- If the repository has no mature spec style, choose a simple structure and keep it consistent within the new document.

## Write Testable Specifications

- Define the subject, scope boundary, and affected components before describing behavior.
- Separate normative decisions from rationale, notes, examples, and maintainer guidance.
- Make explicit:
  - what the system must do
  - what it must not do
  - what is intentionally deferred
  - what assumptions the design relies on
- Prefer concrete artifacts over vague prose: interfaces, schemas, directory layouts, commands, state diagrams, request/response examples, diagnostics, or fixture definitions.
- Add at least one example or expected artifact for every tricky rule, merge behavior, exception, or boundary case.
- State what each example proves. Do not leave examples as decoration.
- For each substantive rule, try to state at least one corresponding assertion, fixture, or validation approach. If you cannot, the spec is probably underspecified.

## Stay Grounded

- Do not invent normative behavior when the governing sources are silent, inconsistent, or superseded.
- When sources disagree, surface the contradiction and point to the exact sources rather than averaging them together.
- Prefer exact file and section references over paraphrased memory.
- Preserve the difference between current behavior, target behavior, and open questions.

## Prefer Explicit Structure

- Open with why the design exists, not only what it contains.
- Add dependency, scope, or related-document context when the project style supports it.
- Use explanatory labels when needed, such as `Design note`, `Expected output`, `Why this example matters`, or `Open question`.
- Keep informative material from sounding normative.

## Use A Practical Output Shape

- For a new or heavily revised spec, prefer:
  - scope and dependencies
  - governing decisions or requirements
  - semantic model or architecture
  - edge cases and exceptions
  - examples and expected artifacts
  - validation, diagnostics, or test implications
  - changelog or migration impact
- If the project has a stronger native convention, follow that instead.

## Preserve Traceability And Scope Control

- Use a requirements-first flow when the problem is still ambiguous.
- Keep a clear chain from requirement to design decision to validation artifact.
- Capture preserved behavior and non-goals so implementation work does not broaden scope accidentally.
- Use lightweight task implications only when they help future implementation; do not bloat the spec with project-management detail.

## Use Bundled References

- Read `references/project-adaptation.md` before writing in an unfamiliar repository.
- Read `references/output-shapes.md` when choosing how to structure the deliverable.
- Read `references/example-projects.md` for cross-project examples, including FormSpec as a high-thoroughness exemplar.
- Read `references/requirements-to-validation.md` for distilled guidance on turning requirements into design and validation artifacts.
- Read `references/eval-workflow.md` when setting up repeatable qualitative and trigger evals.
- Read `references/eval-cases.md` and `references/eval-scorecard.md` when running repeatable forward-tests.
- Read `references/trigger-evals.json` when checking whether the description triggers in the right cases.
- Read `references/iteration-patterns.md` when refining the skill based on real usage.
- Read `references/skill-evals.md` when refining or forward-testing the skill.
