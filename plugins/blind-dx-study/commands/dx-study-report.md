---
name: dx-study-report
description: Render a completed blind DX study wave into the standard findings report
arguments:
  - name: run
    description: The Workflow run id (or a path to its result JSON) to render
    required: false
---

Render the results of a completed blind DX study wave (`$ARGUMENTS.run`) into the standard report,
using `skills/blind-dx-study/resources/report-template.md` as the structure.

1. **Load the synthesis + subject data.** From the Workflow run's return value if you have it, or by
   reading the run's `journal.jsonl` in the transcript dir (each entry's result is an agent's return
   value; the subject reports carry `easeRating`, the verifier verdicts carry `confirmed`, and the
   synthesis carries `findings` / `verdict` / `baselineComparison`).
2. **Fill the template.** Ease trend + per-cohort means; the `yes/partly/no` verdict verbatim from
   synthesis; the RESOLVED-vs-PERSISTS baseline pass; the findings table (severity, surface,
   confirmed?, new?); quick wins vs deeper work.
3. **Normalize honestly.** If a low subject score came from a *not-reproduced* claim, show both the
   raw and the normalized ease and say why — never average a phantom into the score.
4. **Write the report** to the project's scratch/reports location (e.g. `scratch/dx-usability-study-<wave>-<date>.md`).
5. **Hand off the fixes.** List each **confirmed** finding as a pickup-ready issue candidate for the
   fix loop (e.g. `/file-issue`); keep subjective/not-reproduced items out of the fix queue or route
   them to a docs pass.
