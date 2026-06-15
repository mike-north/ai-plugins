# Example Projects

Use these as audit exemplars.

## FormSpec

Good audit targets:

- implementation vs numbered design docs
- test fixtures vs expected artifacts
- diagnostic structures vs tooling spec
- parity helpers vs parity rules
- changelog resolutions vs current implementation

Why it is a strong exemplar:

- it has explicit cross-document dependencies
- it treats examples and expected outputs as meaningful evidence
- it records resolved ambiguities and superseded decisions

## Generic API Service

Good audit targets:

- endpoint behavior vs API contract
- error codes vs documented failures
- schema evolution vs compatibility promises

## Compiler Or Build Tool

Good audit targets:

- phase ordering
- diagnostic determinism
- IR or AST shape guarantees
- fixture coverage for edge cases

## UI Or Product Workflow

Good audit targets:

- state transitions
- user-visible invariants
- error handling
- analytics/logging obligations when documented
