# Spec Audit Eval Scorecard

Score each dimension from 0 to 2.

- `0` = poor or missing
- `1` = partial
- `2` = strong

## Dimensions

1. Governing-source selection
   - did the agent identify the correct authoritative sources before auditing implementation
2. Evidence quality
   - were findings tied to exact spec and implementation artifacts
3. Classification quality
   - did the agent distinguish divergence, missing behavior, weak coverage, and ambiguity correctly
4. Regression awareness
   - did the agent consider preserved behavior, superseded decisions, or downstream drift
5. Test-awareness
   - did the audit consider what relevant behavior the tests actually check and what remains uncertain
6. Restraint
   - did the agent avoid turning ambiguity into fake certainty or style nits into primary findings

## Interpretation

- `10-12`: strong, keep current skill behavior
- `7-9`: usable, refine specific weak spots
- `4-6`: inconsistent, tighten instructions or references before trusting broadly
- `0-3`: poor, revisit trigger wording and governing-source workflow

## Mandatory Notes

Record these even if the numeric score is high:

- what sources the agent treated as authoritative
- what evidence it missed, if any
- whether it separated weak coverage from implementation divergence
- whether it handled ambiguity and superseded decisions correctly
