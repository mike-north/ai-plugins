# Spec Authoring Eval Scorecard

Score each dimension from 0 to 2.

- `0` = poor or missing
- `1` = partial
- `2` = strong

## Dimensions

1. Source selection
   - did the agent identify the governing docs, code, tests, or decisions before writing
2. Project adaptation
   - did the document fit the local repo's conventions instead of importing a foreign template
3. Scope control
   - were scope, assumptions, non-goals, and preserved behavior explicit
4. Testability
   - did substantive rules imply examples, expected artifacts, or validation guidance
5. Grounding
   - were claims tied to actual repository artifacts rather than generic advice
6. Restraint
   - did the agent avoid unnecessary breadth, speculative behavior, or workflow bloat

## Interpretation

- `10-12`: strong, keep current skill behavior
- `7-9`: usable, refine specific weak spots
- `4-6`: inconsistent, tighten instructions or references before trusting broadly
- `0-3`: poor, revisit trigger wording and core workflow

## Mandatory Notes

Record these even if the numeric score is high:

- what the agent read first
- what important artifact it failed to read, if any
- whether examples clearly stated what they proved
- whether validation implications were concrete
