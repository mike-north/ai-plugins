# blind-dx-study

Measure how easy a library, CLI, or SDK actually is to pick up — with evidence, not the
maintainer's own knowledge-blinded intuition.

A **blind DX usability study** runs in waves. Each wave fans out fresh-eyes subject agents through
real getting-started scenarios, seeing only what a genuine first-time user would (published or
packaged artifacts, findable docs, `--help`) and **never the source tree**. Every functional claim
a subject makes is independently reproduced before it's allowed to count. A synthesis stage dedupes,
ranks, and returns a convergence verdict plus an ease score you can trend across waves. Fix the
findings, run another wave, watch the score converge.

## Why blind + verified

Two silent failure modes destroy a usability study — the report still renders, it's just false:

- **A subject that isn't really blind** (peeks at source or tests) stops being a proxy for a real
  user and can't find the doc gaps that hurt people.
- **An unverified claim** (a truncated snippet, a stale doc-misquote, a wrong flag) weighted as a
  real defect sends fixes chasing ghosts and hides genuine convergence.

The pipeline is built to prevent both: strict blinding + machine-state isolation on every subject,
and an independent `dx-claim-verifier` reproduces each functional claim before synthesis weights it.

## What's in the box

| Piece | What it is |
|-------|-----------|
| `skills/blind-dx-study` | The methodology: two cohorts, the three-stage pipeline, blinding rules, the convergence gate, journal-recovery. Start here. |
| `agents/dx-evaluator` | The blind subject — fresh-eyes, workspace-confined, docs-only. |
| `agents/dx-claim-verifier` | The skeptical reproducer that confirms/refutes each functional claim. |
| `rules/blinding-and-isolation` | The non-negotiable invariants every subject/verifier prompt must carry. |
| `skills/.../resources/schemas.mjs` | The subject / verdict / synthesis structured-output schemas. |
| `skills/.../resources/workflow-template.mjs` | A self-contained, fill-in-the-blanks Workflow script for one wave. |
| `skills/.../resources/prompt-builder.mjs` | Annotated builders for the shared subject/verifier preamble. |
| `skills/.../resources/report-template.md` | The findings-report structure. |
| `/dx-study`, `/dx-study-report` | Scaffold + run a wave; render the report. |

## Quick start

1. `/dx-study <what to study>` — scaffolds per-subject workspaces, extracts the target's sandbox
   mechanism, authors the scenarios across both cohorts, and runs the wave via the Workflow tool.
2. `/dx-study-report <run>` — renders the synthesis into the standard report and lists the confirmed
   findings as pickup-ready issues.

## Closing the loop

Each **confirmed** finding is a pickup-ready issue for a fix loop — this plugin is the *measurement*
half of a measure → fix → remeasure cycle, and pairs naturally with an engineering-fleet workflow
(`/file-issue`). Subjective or not-reproduced items stay out of the fix queue or go to a docs pass.
Stop when a sustained high ease plateau across waves says the bar is met.

## License

ISC
