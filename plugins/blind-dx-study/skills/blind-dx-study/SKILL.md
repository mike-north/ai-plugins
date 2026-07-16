---
schemaVersion: 0.1.0
name: blind-dx-study
description: >-
  Use when you want to measure how easy a library, CLI, or SDK is to adopt for the first time —
  a blind developer-experience usability study. Fans out fresh-eyes subject agents that see only
  what a real user would (published/packaged artifacts, findable docs, --help), never the source
  tree; captures ranked friction against an "incredibly easy" bar across two cohorts (has-docs vs
  registry-only); independently reproduces every functional claim before weighting it; and
  synthesizes a convergence verdict comparable across waves. Pairs with an engineering fleet to
  close a measure → fix → remeasure loop.
---

# Blind DX usability study

A repeatable way to answer "is this actually easy to pick up?" with evidence instead of the
maintainer's own (blinded-by-knowledge) intuition. You run **waves**: each wave dispatches blind
subject agents through real getting-started scenarios, verifies what they claim broke, and returns
a ranked findings set plus an ease score you can trend over time. Fix the findings, run another
wave, and watch the score converge.

## The core discipline

**Detect friction with genuinely blind subjects; confirm every functional claim with an independent
reproducer; only then let a finding count.** Two failure modes destroy a study's value, and both are
silent — the report still renders, it is just false:

1. **A subject that isn't really blind** (peeks at source/tests) stops being a proxy for a real
   user and can no longer find the doc gaps that hurt people.
2. **An unverified claim** (a truncated snippet, a stale doc-misquote, a wrong flag) weighted as a
   real defect sends fixes chasing ghosts and masks genuine convergence.

The pipeline below is built to prevent both. Do not shortcut them.

## The three stages (one wave)

| Stage | Who | What | Output |
|-------|-----|------|--------|
| **Subjects** | `dx-evaluator` (sonnet), one per scenario | Run a real getting-started scenario under strict blinding + sandbox rules | `SUBJECT_SCHEMA` report: taskCompleted, friction events (severity + repro), broken features, ease 1–10, top fixes |
| **Verify** | `dx-claim-verifier` (sonnet) | Independently reproduce each subject's functional claims (capped per subject) in a fresh sandbox | `VERDICT_SCHEMA`: confirmed / not-reproduced + actual behavior |
| **Synthesize** | one high-effort agent | Dedupe, rank by severity × subjects × confirmed, compare to the baseline, make the convergence call | `SYNTHESIS_SCHEMA`: findings, ease summary, baseline comparison, verdict, quick wins, deeper work |

Run it with the **Workflow tool** as a `pipeline()` so each subject's claims verify the moment that
subject finishes — no barrier between "all subjects done" and "start verifying." The synthesis is
the only barrier. `resources/workflow-template.mjs` is a fill-in-the-blanks, self-contained script
for exactly this shape; `resources/schemas.mjs` and `resources/prompt-builder.mjs` are the annotated
sources for the schemas and the shared subject preamble it inlines.

## Two cohorts (always run both)

- **Cohort A — "found the docs":** its workspace contains copies of the docs a user could plausibly
  find (README + API reference). Measures the best-case documented experience.
- **Cohort B — "registry / types only":** no external docs at all — only the installed package's
  own shipped README, its metadata, its type declarations, and `--help` / error output. Measures the
  bare experience most users hit first. Cohort B is your purest blind-newcomer signal; weight it.

## Blinding & isolation are non-negotiable

Every subject and verifier prompt must enforce both invariants — see the bundled
`rules/blinding-and-isolation.md`. In short: subjects never read the target's source/tests/history,
and never touch real machine state (isolated HOME/config, fake values only, stop-before-unsafe). The
orchestrator's setup job is to identify the target's actual sandbox mechanism from its docs and bake
the concrete command form into every prompt — don't leave "stay sandboxed" vague.

## Running a wave

1. **Scaffold** per-subject workspaces under a study root; for cohort A, copy the findable docs into
   each workspace. Make the installable artifact available the way a user gets it — a published
   release, or **pre-release tarballs / a local registry built from the exact commit under test** so
   the versions match HEAD.
2. **Extract the sandbox mechanism** from the docs (the config-dir override, isolated-home pattern,
   in-memory backend, …) and write the exact command form into the prompts.
3. **Author the scenarios** — one per subject, split across cohorts. Good coverage: primary quick
   start, the core access/usage patterns, CLI onboarding, deliberate error-recovery, each secondary
   surface (SDK variant, test helpers), and the two cohort-B blind paths. Tell each subject not just
   the task but *exactly what to judge*.
4. **Fill and run** `resources/workflow-template.mjs` via the Workflow tool, passing `args` with the
   study root and artifact path. `/dx-study` scaffolds this.
5. **Report** with `resources/report-template.md`. `/dx-study-report` renders it.

## Convergence — how a wave decides "done"

- Track the **ease trend** wave-over-wave; a healthy campaign climbs and then plateaus high.
- Mark each finding `isNewSinceBaseline` so regressions introduced by fixes are visible.
- The synthesizer must go **finding-by-finding** through the baseline's open items (RESOLVED vs
  PERSISTS) rather than re-deriving from scratch.
- The verdict is `yes / partly / no`. A defensible **YES** needs the getting-started core AND every
  probed secondary surface uniformly clearing the bar, with no *confirmed* remaining blocker/major.
- **Weight by confirmation.** Before a low score or a "blocker" changes the verdict, check
  `verifications[].verdict.confirmed`. A repeatedly-unconfirmed claim is noise — normalize it out and
  say so; don't average a phantom into the score.

## Closing the loop

Each **confirmed** finding is a pickup-ready issue for a fix loop (pairs naturally with an
engineering-fleet workflow / `/file-issue`); subjective or not-reproduced items stay out of the fix
queue or go to a docs pass. After fixes land, run the next wave against the rebuilt artifacts. Stop
when the maintainer judges the bar met — a sustained high plateau across waves is the signal, not an
arbitrary wave count.

## Operational notes (learned the hard way)

- **Synthesis can hang on very large JSON input.** If the synthesis agent stalls, the per-agent
  results are recoverable from the run's journal (`journal.jsonl` in the transcript dir): each entry's
  result is the agent's return value and its key/label identifies the agent. You can extract the
  subject reports and hand-author the verdict from them rather than re-running the whole wave.
- **Cap verification fan-out** per subject (the template caps at 4 claims) so one very chatty subject
  can't spawn dozens of verifiers; `log()` when you drop claims so the cap is visible, never silent.
- **Pin versions to the commit under test.** If subjects install from the public registry, make sure
  the published version equals the code you're measuring, or build tarballs from HEAD — otherwise you
  are studying a different artifact than you think.
