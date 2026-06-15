# Project Adaptation

Use this file before auditing in a new repository.

## Find The Governing Contract

Look for:

- specs, RFCs, ADRs, or architecture docs
- changelogs or decision logs
- protocol docs or schemas
- tests and fixtures
- generated artifacts
- migration notes or compatibility policies

## Determine Authority

Ask:

- which source is current
- which source is normative
- whether examples and expected outputs are binding
- whether decision logs supersede older prose
- whether draft docs describe target behavior rather than current behavior

## FormSpec As An Exemplar

FormSpec is useful as a model for:

- cross-document dependency reading
- checking examples and expected artifacts as part of the contract
- tracking superseded decisions in a changelog
- treating parity, determinism, and diagnostics as auditable behaviors

Do not assume every project has this level of documentation maturity.
