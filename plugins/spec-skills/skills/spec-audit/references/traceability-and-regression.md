# Traceability And Regression

Use this file when deciding whether code truly diverges from a specification.

## Follow The Chain

Audit each important behavior across these layers:

1. requirement or governing decision
2. design rule or documented consequence
3. implementation and validation artifact

If the chain breaks, classify the gap accurately:

- requirement exists but implementation is missing
- implementation exists but tests do not prove it
- implementation follows an older or different rule
- the specification is not clear enough to judge

## Preserve Behavior Is Part Of The Contract

Do not audit only for newly added behavior. Also check:

- behavior the spec says must remain unchanged
- explicit non-goals
- compatibility promises
- regression boundaries implied by migration notes or prior decisions

Implementation can be wrong by doing too much, not only by doing too little.

## Downstream Drift Matters

When the governing spec changes, check whether downstream artifacts changed too:

- tests
- fixtures
- expected outputs
- generated artifacts
- changelog or decision log entries

A code change that matches the new spec may still be under-validated if the rest of the artifact chain did not move with it.

## Underdefined Specs Are Their Own Finding

If the governing sources do not let you decide confidently, report that as a spec problem. Do not create false precision from weak or conflicting sources.
