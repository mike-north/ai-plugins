# Requirements To Validation

Use this file when a spec needs to move from vague intent to implementation-guiding clarity.

## Keep A Visible Chain

Each important behavior should be traceable through three layers:

1. requirement or governing decision
2. design rule or structural consequence
3. validation artifact such as a test assertion, fixture, expected output, or diagnostic

If one layer is missing, call that out explicitly instead of letting the gap hide in prose.

## Start With Requirements When The Problem Is Fuzzy

Use a requirements-first flow when:

- stakeholders agree on the problem but not the shape of the solution
- multiple implementation approaches are plausible
- scope creep is likely unless obligations are named early
- backward compatibility or preserved behavior matters

Once the requirements are stable enough, convert them into concrete design rules and expected artifacts.

## Preserve Behavior Deliberately

When changing an existing system, specify:

- behavior that must remain unchanged
- behavior that is intentionally extended or narrowed
- explicit non-goals
- migration or compatibility constraints where relevant

This keeps implementation work from broadening the change by accident.

## Prefer Validation-Ready Rules

A strong rule usually implies at least one of:

- a schema or interface example
- a state transition example
- a request or response sample
- a fixture definition
- a diagnostic example
- a test assertion or comparison rule

If a rule cannot be checked in any concrete way, it is often too vague.

## Update Downstream Artifacts Together

When you change a requirement or design rule, check whether these also need updates:

- examples
- expected outputs
- fixtures
- tests
- changelog or decision log entries
- migration notes
