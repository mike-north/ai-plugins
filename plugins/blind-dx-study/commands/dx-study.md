---
name: dx-study
description: Scaffold and run one wave of a blind DX usability study against a target
arguments:
  - name: target
    description: What to study (a package/CLI/SDK, optionally with the artifact source and prior baseline)
    required: false
---

Set up and run one **wave** of a blind DX usability study for `$ARGUMENTS.target`, following the
`blind-dx-study` skill. Do the setup inline, then run the wave with the Workflow tool.

## Setup (inline — do this before dispatching subjects)

1. **Identify the artifact a real user would install.** Prefer the exact commit under test: build
   pre-release tarballs or a local registry from HEAD, or confirm the published version equals the
   code being measured. Record the artifact path.
2. **Extract the sandbox mechanism** from the target's own docs (config-dir override, isolated-home
   pattern, in-memory backend, …). You will bake the concrete command form into every prompt. If the
   target documents no way to stay sandboxed, that is itself a finding — record it and have subjects
   stop before any unsafe operation.
3. **Provision one isolated sandbox per subject** with the bundled
   `skills/blind-dx-study/scripts/dx-study-sandbox <study-root> <subject-id>` (deterministic,
   guarded, network-free — prefer it over hand-rolled `mkdir`/`git init`/`cp`). Pass `--guide <file>`
   for **cohort A** (drops the findable docs at `GUIDE.md`); omit it for docs-free **cohort B**. Pass
   `--fixture <dir>` only for a work-in-a-codebase study; omit it for the common install-the-target
   study where the subject builds its own workspace.
4. **Author the scenarios** — one `dx-evaluator` subject each, split across cohorts: primary quick
   start, core usage/access patterns, CLI onboarding, deliberate error-recovery, each secondary
   surface, and the two cohort-B blind paths. Tell each subject exactly what to judge, not just the
   task.

## Run

Fill `skills/blind-dx-study/resources/workflow-template.mjs` (the four `<<FILL>>` zones: install +
safety strings, the `TASKS` scenarios, and the baseline context) and run it via the **Workflow**
tool, passing `args` as `{ "root": "<study-root>", "artifacts": "<artifact-path>", ... }`.

Honor the bundled `rules/blinding-and-isolation.md` in every prompt: subjects never read the
target's source/tests/history and never touch real machine state (isolated HOME/config, fake values,
stop-before-unsafe). Verify every functional claim before weighting it — the template already
pipelines a `dx-claim-verifier` per subject.

When it completes, summarize the verdict and ease trend, and offer to render the full report with
`/dx-study-report`.
