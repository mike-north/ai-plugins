---
name: spec-authoring
description: Draft, revise, or clarify implementation-guiding specifications as a connected repository collection. Use for contracts, requirements, design decisions, examples, edge cases, or validation criteria, including establishing missing accepted intent before an audit can resume.
---

# Spec Authoring

Read [the shared workflow](../domain-planning/references/workflow.md) at entry. Reuse the current domain plan, decisions, and live work instead of starting a parallel document. On a fresh session or when saving work, follow [artifact and state conventions](../domain-planning/references/artifacts-and-state.md); read [preferences](../domain-planning/references/preferences.md) only when placement or campaign tracking needs resolution.

The primary journey develops product essence and rough domain sketches into a domain plan, then elaborates that plan into a specification collection. People may enter at this authoring step. A specification can be a folder of related artifacts; the domain plan remains first-class, not a draft discarded when contracts arrive.

## Establish The Job

- Identify the task as `draft`, `revise`, `clarify`, or `gap-fill`.
- State the target artifact before deep work: document, section, feature area, protocol, schema, or workflow.
- State the expected deliverable shape up front.
- Reference particular domain-plan sections for meaning and responsibility boundaries. Add operation and representation detail without copying or redefining those concepts.
- If meaning is unresolved, route the bounded question to domain planning; use Deep Design only when the organizing frame needs reconsideration. Preserve the original job and resumption condition.
- If one missing fact is genuinely blocking correctness, ask one narrow question. Otherwise proceed with bounded assumptions and label them explicitly.

## Adapt To The Current Project

- Inspect the project's existing specifications, architecture docs, RFCs, ADRs, or design notes before writing.
- Reuse the project's preferred terms, section names, and evidence style instead of importing a generic template unchanged.
- Identify governing sources first: root principles, prior decisions, changelogs, issue discussions, tests, and existing generated artifacts.
- Treat sources according to their standing. Code and tests can establish current behavior, not automatically accepted intent. If no governing specification exists, draft the smallest needed account and surface consequential choices; do not bless that draft as normative without acceptance.
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
- State what each example checks or illustrates and its limits. Do not leave examples as decoration or imply that examples prove business truth.
- For each substantive rule, try to state at least one corresponding assertion, fixture, or validation approach. If you cannot, the spec is probably underspecified.

## Stay Grounded

- Do not invent normative behavior when the governing sources are silent, inconsistent, or superseded.
- When sources disagree, surface the contradiction and point to the exact sources rather than averaging them together.
- Prefer exact file and section references over paraphrased memory.
- Preserve the difference between current behavior, target behavior, and open questions.
- Separate acceptance from delivery scope: an accepted future capability is not necessarily a requirement for the current release. Record known acceptance sources and supersession; accepting one choice does not ratify the entire collection.
- All specification-shaped material, including proposed contracts, belongs in the repository. Requirements, rationale, decisions, examples, and guidance needed to review code must be included in the reviewable revision. Promote relevant substance from issues or personal notes; a bare link or local-only file is insufficient.

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
- Keep bounded campaign tracking and individual checkpoints separate from project-lifetime knowledge. Use the existing authoritative campaign record and the configured co-located working area, not a central all-projects store.
- Hand implementation the task, relevant plan/contract sections, current commitments, non-goals, validation examples, and unresolved questions. Repository engineering instructions govern execution. Surface implementation discoveries that contradict accepted intent instead of quietly changing it.
- When this work resolves an audit dependency, return the accepted sources and outstanding decisions to the original audit. A newly accepted target is not evidence that earlier code violated an older rule.

## Use Bundled References

- Use [artifact templates](../domain-planning/assets/artifact-templates.md) when a project lacks a useful shape; adapt only the relevant record.
- Read `references/project-adaptation.md` before writing in an unfamiliar repository.
- Read `references/output-shapes.md` when choosing how to structure the deliverable.
- Read `references/example-projects.md` for cross-project examples, including FormSpec as a high-thoroughness exemplar.
- Read `references/requirements-to-validation.md` for distilled guidance on turning requirements into design and validation artifacts.
- Read `references/eval-workflow.md` when setting up repeatable qualitative and trigger evals.
- Read `references/eval-cases.md` and `references/eval-scorecard.md` when running repeatable forward-tests.
- Read `references/trigger-evals.json` when checking whether the description triggers in the right cases.
- Read `references/iteration-patterns.md` when refining the skill based on real usage.
- Read `references/skill-evals.md` when refining or forward-testing the skill.
