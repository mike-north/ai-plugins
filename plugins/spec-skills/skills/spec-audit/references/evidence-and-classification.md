# Evidence And Classification

Use this file when writing findings.

## Evidence Shape

Each finding should include:

- Intent: file, section, acceptance basis, delivery scope, and expected behavior or responsibility
- Evidence: code, comments, tests, outputs, or artifacts supporting the observation
- Reasoning and impact: how the evidence conflicts with intent or supports a concern, and why it matters
- Follow-up: code, test, spec, or decision-log update

Include the examined revision and coverage limits. Comments are evidence of expressed intent, not proof of realized behavior. Pair source and evidence without overstating either. A proposal to revise intent is not authorization to change it.

## Classification Rules

- `aligned`
  - implementation matches the governing behavior closely enough
- `divergent`
  - implementation exists, but differs from the specified behavior
- `specified but missing`
  - the spec is clear and the behavior is not implemented
- `insufficiently tested`
  - the obligation has a meaningful evidence gap; explain which behavior or boundary remains unchecked rather than requiring exhaustive proof
- `spec ambiguity or contradiction`
  - the governing sources do not support a confident implementation judgment
- `reasoned concern`
  - concrete evidence suggests weakened purpose, responsibility boundaries, assumptions, or maintainability relevant to the accepted design, even without a demonstrated failure
- `unexamined or unavailable evidence`
  - the area or source was not assessed; this is coverage information, not alignment

Clear mismatches, reasoned concerns, ambiguities, and unexamined areas must remain distinguishable. Use certainty proportional to evidence; do not suppress a useful concern merely because no failing scenario has been proved. Different implementation structure is allowed when meaning and responsibilities are preserved. Severity, confidence, and coverage answer different questions.

## Common Failure Modes

- code matches an older document that has been superseded
- tests cover the happy path but not the specified edge cases
- generated outputs differ from the format the spec makes normative
- reviewers focus on message wording while missing structured diagnostic requirements
- an implementation is blamed when the spec itself is inconsistent
- a future accepted obligation is reported as a current-release defect
- a locally drafted specification is treated as present in the reviewable revision
- newly synthesized intent is treated as historically accepted
- comments or several agreeing agents are treated as proof
- a class/table correspondence rule substitutes for purpose and responsibility analysis
