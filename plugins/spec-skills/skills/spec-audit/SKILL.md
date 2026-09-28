---
name: spec-audit
description: Review alignment among accepted domain plans, specifications, code, comments, tests, and outputs. Use for PRs, migrations, regressions, responsibility drift, or missing/contradictory intent. Distinguish clear mismatches, reasoned concerns, ambiguities, and unexamined scope without requiring formal proof.
---

# Spec Audit

Read [the shared workflow](../domain-planning/references/workflow.md) at entry. Use the project's specification collection and particular domain-plan references. For session recovery and persistence, follow [artifact and state conventions](../domain-planning/references/artifacts-and-state.md). The original audit question must survive any dependency or fresh session.

## Establish The Audit

- Identify the audit target: code, tests, generated outputs, behavior, or a pull request.
- Identify the governing spec sources before inspecting implementation details.
- State the expected deliverable shape up front.
- Identify the revision or supplied snapshot being assessed. A repository-only review must have the required intent and rationale in that reviewable revision, not solely in the author's local notes, user preferences, or issue discussion.
- If one missing fact is blocking a correct audit boundary, ask one narrow question. Otherwise proceed with bounded assumptions and label them.

## Decide What Governs

- Separate normative sources from informative ones.
- Read current decision logs, changelogs, or superseding notes before treating an older document as authoritative.
- Use examples, expected outputs, fixtures, and comparison helpers as part of the governing contract when the project treats them as such.
- Preserve the distinction between current behavior, target behavior, and future ideas.
- Existing accepted prose, decisions, or examples may govern without a file named “spec.” If no governing specification exists, explicitly route to spec authoring, which may need domain planning. Preserve the question, bounded dependency, sources, pending choice, and resumption condition. Do not infer normative requirements from code or silently ratify the draft.
- Resume against actual accepted intent. If acceptance is unavailable, complete independent review and leave the dependent judgment unresolved. Clearly label newly accepted targets versus pre-existing obligations; avoid endless capability-routing loops.
- Bring review-needed substance from external/private sources into checked-in project artifacts through the authorized authoring workflow. Do not treat a local file, staging, or an external link as sufficient. In read-only mode, report the missing review context and the needed follow-up instead of claiming to have saved it.

## Adapt To The Current Project

- Learn the repository's spec style before judging divergence.
- Map the feature to the likely code, tests, and generated artifacts that should embody the requirement.
- If the repo has multiple overlapping documents, build a short traceability map instead of trusting the nearest single document.

## Audit Meaning, Responsibilities, And Behavior

- Compare semantic behavior, outputs, diagnostics, invariants, purposes, and responsibility boundaries. Architectural responsibility drift can matter before an externally visible failure appears.
- Treat different internal structures as acceptable when they preserve applicable intent. No one-to-one correspondence between concepts, classes, tables, or services is required.
- Distinguish plan-quality assessment from implementation conformance. Reuse [domain reasoning](../domain-planning/references/domain-reasoning.md) to examine whether the plan itself is coherent and useful; agreement between code and a flawed plan does not validate the plan.
- Comments express intended meaning, boundaries, and invariants; they do not prove behavior. Compare them with implementation and evidence rather than accepting either blindly.
- Prefer checking the spec's own examples and expected artifacts before inventing new interpretations.
- Check whether preserved behavior or non-goals were accidentally violated by the implementation.

## Classify Findings Explicitly

- Use these buckets:
  - aligned
  - divergent
  - specified but missing
  - insufficiently tested
  - spec ambiguity or contradiction
  - reasoned concern
  - unexamined or unavailable evidence
- Clear mismatches and grounded concerns are both useful. A concern needs a source, evidence, reasoning, and consequence; it does not require a provable failing scenario. Keep uncertainty explicit and severity separate from confidence and coverage.
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
- Never update specifications merely to bless existing code. A spec change is a candidate follow-up requiring its actual product/design decision, not an automatic audit repair.

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
- Follow compression decisions to their enabling assumptions and revision triggers. Propose reconsideration when evidence breaks an assumption; preserve the prior rationale and migration implications.
- Do not manufacture a failure when the real issue is that the spec is underdefined.

## Use Bundled References

- Use [focused specialist assessment](../domain-planning/references/specialist-review.md) for independent plan challenges or bounded alignment tracing where useful and authorized. Run the same lenses yourself when delegation is unavailable.
- Use the optional [review-input checker](references/review-inputs.md) to establish that selected documents are actual files in a committed snapshot. It does not judge sufficiency, authority, or semantics.
- For repository-only PR/CI review without tools or sibling skills, adapt the self-contained [Markdown review adapter](assets/repository-review.md) into checked-in project review guidance. Do not claim host activation without verifying it.
- Read `references/project-adaptation.md` before auditing in an unfamiliar repository.
- Read `references/evidence-and-classification.md` for finding structure and classification rules.
- Read `references/example-projects.md` for cross-project exemplars, including FormSpec as a strong audit corpus.
- Read `references/traceability-and-regression.md` for distilled guidance on following requirements through implementation and tests.
- Read `references/eval-workflow.md` when setting up repeatable qualitative and trigger evals.
- Read `references/eval-cases.md` and `references/eval-scorecard.md` when running repeatable forward-tests.
- Read `references/trigger-evals.json` when checking whether the description triggers in the right cases.
- Read `references/iteration-patterns.md` when refining the skill based on real audit sessions.
- Read `references/skill-evals.md` when refining or forward-testing the skill.
