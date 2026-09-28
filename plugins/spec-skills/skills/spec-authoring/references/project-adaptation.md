# Project Adaptation

Use this file before writing a spec in a new repository.

## Find The Governing Sources

Look for:

- architecture docs
- RFCs or ADRs
- changelogs or decision logs
- package READMEs
- tests that encode expected behavior
- generated artifacts or wire formats
- issue threads or design notes if the repo treats them as authoritative

## Extract The Local Style

Check:

- title format
- section naming
- whether docs distinguish normative vs informative material
- how examples are presented
- whether docs link requirements to tests or expected outputs
- whether changelog or migration notes are updated alongside spec changes

## Decide The Writing Mode

- Mature spec ecosystem:
  - mirror the local structure and terminology closely
- Partial spec ecosystem:
  - preserve local terms, but impose a clearer structure and stronger testability
- No real spec ecosystem:
  - use a simple consistent structure and make scope, assumptions, examples, and validation explicit

## FormSpec As An Exemplar

FormSpec is useful as an example of thoroughness, not as a universal template.

Notable reusable patterns from FormSpec:

- explicit root principles
- numbered cross-referenced docs
- concrete expected artifacts
- examples that say what they check or illustrate and what they do not establish
- explicit exceptions and non-properties
- parity or consistency sections for multiple authoring surfaces

Do not copy its numbering system or terminology into unrelated projects unless the repository already wants that style.
