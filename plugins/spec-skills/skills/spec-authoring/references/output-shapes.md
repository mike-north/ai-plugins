# Output Shapes

Choose the smallest structure that still makes the spec testable.

## Shape A: Requirements-Heavy

Use when the behavior is unclear and the design should follow from explicit requirements.

Suggested sections:

1. problem and scope
2. requirements or governing decisions
3. design or model
4. edge cases and exceptions
5. expected outputs or examples
6. validation and tests

## Shape B: Architecture-Heavy

Use when package boundaries, APIs, or data models are the main concern.

Suggested sections:

1. overview and dependencies
2. component or model definitions
3. composition or data flow
4. output mapping or interfaces
5. diagnostics, errors, or failure handling
6. examples and expected artifacts

## Shape C: Clarification Patch

Use when updating an existing spec rather than writing a new one.

Suggested output:

- sections to change
- exact ambiguity or contradiction
- replacement wording or structural change
- effect on examples, tests, and changelog

## Minimum Quality Bar

Regardless of shape, include:

- scope boundary
- assumptions
- at least one concrete example for non-trivial behavior
- some validation or testing implication
