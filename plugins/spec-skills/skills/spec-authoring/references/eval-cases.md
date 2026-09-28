# Spec Authoring Eval Cases

Use these cases for repeatable forward-tests of `$spec-authoring`.

Run each case in a fresh thread when possible. Do not pre-explain the expected answer to the evaluating agent.

## Contents

- Case 1: Mature Spec Ecosystem Extension
- Case 2: Sparse Docs, New Spec
- Case 3: Clarification Patch
- Case 4: Validation-First Rewrite
- Recording Template

## Case 1: Mature Spec Ecosystem Extension

Goal:

Measure whether the skill can extend an existing spec corpus without breaking local style or traceability.

Suggested artifact set:

- a repository with existing numbered specs or ADRs
- a decision log or changelog
- one target feature area that touches multiple documents

Recommended FormSpec version:

- repo root: `<path-to-formspec-repo>`
- prompt:
  `Use $spec-authoring to draft a new numbered spec for extension package discovery and registration. Match the repo's existing docs style, identify dependencies first, and include examples, expected artifacts, and validation implications.`

Success criteria:

- reads governing docs before outlining
- mirrors the local doc structure instead of forcing a generic template
- states scope and dependency boundaries clearly
- includes at least one concrete example and one validation implication
- distinguishes target behavior from unresolved questions

Common failure modes:

- generic architecture-doc boilerplate
- missing changelog or decision-log implications
- examples that do not say what they check or illustrate
- prose that sounds confident where the sources are actually ambiguous

## Case 2: Sparse Docs, New Spec

Goal:

Measure whether the skill can impose useful structure in a project with weak existing spec conventions.

Suggested artifact set:

- repository with code and tests but little formal design documentation
- one feature request or issue description

Prompt template:

`Use $spec-authoring to draft a spec for <feature>. The repo has limited existing design docs, so infer a practical structure from the codebase and keep the spec implementation-guiding and testable.`

Success criteria:

- discovers the local code/test shape before drafting
- chooses a simple structure rather than inventing a heavy framework
- names assumptions explicitly
- includes examples or expected artifacts grounded in the repo
- includes validation or testing implications

Common failure modes:

- overfitting to patterns from another project
- importing sections that have no value in the target repo
- vague requirements with no way to test them

## Case 3: Clarification Patch

Goal:

Measure whether the skill can make a narrow, non-disruptive clarification to an existing spec.

Suggested artifact set:

- existing spec with one ambiguous or contradictory section
- nearby examples or tests that expose the ambiguity

Recommended FormSpec version:

- prompt:
  `Use $spec-authoring to propose the smallest clarification needed in docs/002-tsdoc-grammar.md to resolve one implementation-blocking ambiguity. State which sections should change, why, and what examples or tests must move with the change.`

Success criteria:

- identifies the specific ambiguity rather than rewriting the whole doc
- proposes the smallest viable change
- names downstream examples, tests, or changelog entries that need updates
- preserves unaffected behavior explicitly

Common failure modes:

- rewriting large parts of the document without cause
- changing semantics instead of clarifying them
- ignoring preserved behavior or non-goals

## Case 4: Validation-First Rewrite

Goal:

Measure whether the skill can strengthen an underspecified document by adding examples and expected artifacts.

Suggested artifact set:

- spec or design note with high-level prose but weak examples
- nearby tests or generated outputs

Prompt template:

`Use $spec-authoring to revise <doc> so each substantive rule implies a concrete validation artifact. Add examples, expected outputs, or fixture guidance where the current text is too abstract.`

Success criteria:

- identifies underspecified rules
- adds examples or expected outputs instead of only rewriting prose
- ties rules to plausible assertions, fixtures, or diagnostics
- avoids bloating the document with project-management detail

Common failure modes:

- adding explanation without improving testability
- inventing outputs not grounded in the codebase or domain

## Recording Template

For each run, capture:

- date
- repo
- case id
- prompt used
- files the agent consulted
- final output location or summary
- score from `eval-scorecard.md`
- observed failure modes
- proposed skill change, if any
