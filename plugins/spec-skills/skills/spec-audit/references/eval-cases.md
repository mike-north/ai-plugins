# Spec Audit Eval Cases

Use these cases for repeatable forward-tests of `$spec-audit`.

Run each case in a fresh thread when possible. Do not tell the evaluating agent which findings you expect.

## Contents

- Case 1: Code Vs Explicit Spec
- Case 2: Superseded Decision Detection
- Case 3: Diagnostics And Structured Output
- Case 4: Underdefined Spec Detection
- Recording Template

## Case 1: Code Vs Explicit Spec

Goal:

Measure whether the skill can identify divergence between implementation and a clear spec.

Suggested artifact set:

- a repository with one explicit governing design doc
- code implementing the same feature
- tests with partial coverage

Recommended FormSpec version:

- repo root: `<path-to-formspec-repo>`
- prompt:
  `Use $spec-audit to compare the build package's parity implementation and tests against docs/006-parity-testing.md. Report divergences, specified-but-missing coverage, and any spec ambiguities that block a confident judgment.`

Success criteria:

- identifies the governing sections before reading large amounts of code
- maps claims to code and tests
- separates missing coverage from semantic divergence
- cites exact spec and implementation evidence

Common failure modes:

- treating the task as a generic code review
- findings without spec citations
- collapsing ambiguity into fake certainty

## Case 2: Superseded Decision Detection

Goal:

Measure whether the skill notices that older guidance has been replaced.

Suggested artifact set:

- one current spec
- one changelog or decision log with superseding entries
- code or tests that may match the older version

Recommended FormSpec version:

- prompt:
  `Use $spec-audit to check whether the implementation around circular references matches the current governing spec rather than an older superseded decision.`

Success criteria:

- reads the current doc and the decision log before judging the implementation
- explicitly notes which source governs
- identifies whether code follows current behavior, older behavior, or an ambiguous middle state

Common failure modes:

- auditing against stale prose
- citing only one source when authority depends on multiple documents

## Case 3: Diagnostics And Structured Output

Goal:

Measure whether the skill checks structured requirements rather than only messages or broad behavior.

Suggested artifact set:

- spec sections that define diagnostics, errors, payloads, or structured outputs
- code and tests that exercise them

Recommended FormSpec version:

- prompt:
  `Use $spec-audit to audit whether diagnostics in the ESLint plugin and language server match docs/004-tooling.md, including structured fields, source-location behavior, and determinism expectations.`

Success criteria:

- checks structured fields and invariants
- looks for tests that meaningfully check those behaviors without claiming exhaustive proof
- reports missing determinism or location guarantees separately from wording issues

Common failure modes:

- focusing on message text only
- missing the difference between implementation drift and weak test coverage

## Case 4: Underdefined Spec Detection

Goal:

Measure whether the skill can correctly stop short when the spec is unclear.

Suggested artifact set:

- draft or partially inconsistent spec
- code that implements one plausible interpretation

Prompt template:

`Use $spec-audit to determine whether <implementation area> matches <draft spec>, and explicitly call out any ambiguity or contradiction that prevents a confident pass/fail judgment.`

Success criteria:

- identifies the ambiguous sections precisely
- avoids overcommitting to a pass/fail call when sources conflict
- recommends whether the follow-up is code, tests, or spec clarification

Common failure modes:

- choosing a side without enough authority
- failing to elevate underdefined behavior as its own finding

## Recording Template

For each run, capture:

- date
- repo
- case id
- prompt used
- files the agent consulted
- findings summary
- score from `eval-scorecard.md`
- misclassifications or missed evidence
- proposed skill change, if any
