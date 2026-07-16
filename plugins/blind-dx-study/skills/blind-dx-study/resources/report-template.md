# Blind DX Usability Study — <target> — <wave/date>

## Trend

<one-line ease trend across waves, e.g. 4.75 → 6.43 → 8.44 → 8.5 → 8.9>. This run: **<raw> raw / <normalized> normalized**.

Valid <N>-subject run (`<workflow-run-id>`, <agents> agents, <errors> errors) against <what was under test>.

- **Cohort A** (has docs): A1=<n>, A2=<n>, … (mean <n>).
- **Cohort B** (registry/types only): B7=<n>, B8=<n> (mean <n>).

Note any outliers and whether they were **confirmed** or **confirmed-false** (an unreproduced subject misquote should be normalized out, not averaged in — say so explicitly).

## Verdict: <YES | PARTLY | NO> — "<one-line convergence statement>"

<2–4 sentences: what is uniformly excellent, what (if anything) still gates a uniform YES, and whether newly-introduced behavior helped or hurt.>

## What's resolved / what persists (vs baseline)

For each baseline finding: **RESOLVED** (subjects no longer hit it) or **PERSISTS** (evidence). Flag NEW regressions separately.

## Findings this wave

| # | Sev | Surface | Confirmed? | New? | Finding |
|---|-----|---------|-----------|------|---------|
| <id> | blocker/major/minor/papercut | library/CLI/SDK/docs | confirmed / not-reproduced / subjective | yes/no | <one line> |

## Next wave / fixes

- **Quick wins (mechanical):** <…>
- **Deeper work (design):** <…>

Each confirmed finding becomes a pickup-ready issue for the fix loop (e.g. `/file-issue`); leave subjective/not-reproduced items out of the fix queue or mark them for a docs pass.

## Raw data

- Workflow run `<run-id>` (task `<task-id>`). Inputs / artifacts at `<path>`.
