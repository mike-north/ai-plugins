# Evidence And Classification

Use this file when writing findings.

## Evidence Shape

Each finding should include:

- Spec: file, section, and exact expected behavior
- Evidence: code, tests, outputs, or generated artifacts showing observed behavior
- Impact: why the mismatch matters
- Follow-up: code, test, spec, or decision-log update

## Classification Rules

- `aligned`
  - implementation matches the governing behavior closely enough
- `divergent`
  - implementation exists, but differs from the specified behavior
- `specified but missing`
  - the spec is clear and the behavior is not implemented
- `insufficiently tested`
  - the behavior may exist, but coverage does not prove it
- `spec ambiguity or contradiction`
  - the governing sources do not support a confident implementation judgment

## Common Failure Modes

- code matches an older document that has been superseded
- tests cover the happy path but not the specified edge cases
- generated outputs differ from the format the spec makes normative
- reviewers focus on message wording while missing structured diagnostic requirements
- an implementation is blamed when the spec itself is inconsistent
