# Controlled design/specification evaluations

This suite tests whether the plugin preserves meaning, authority and continuity across independent work—not whether answers repeat its instructions. Read [the pre-execution protocol](PROTOCOL.md), then inspect the separate [subject corpus](corpus.json) and [hidden graders](graders.json).

The first measured calibration is recorded in [RESULTS.md](RESULTS.md), with portable evidence and explicit unrun coverage.

## Run

Requires Python 3.9+ and an authenticated installed Codex CLI supporting the options documented by `codex exec --help`. No packages or global configuration are installed. Commands below run from the repository root:

```sh
python3 -m unittest discover -s plugins/spec-skills/evals/effectiveness -p 'test_*.py'
python3 plugins/spec-skills/evals/effectiveness/harness.py validate
python3 plugins/spec-skills/evals/effectiveness/harness.py snapshot --run scratch/effectiveness/my-run --prior /path/to/prior/skills --deep-design /path/to/original/deep-design/SKILL.md
python3 plugins/spec-skills/evals/effectiveness/harness.py run --run scratch/effectiveness/my-run --cases c01,c03,c04,c05 --variants current,none --repeats 2
python3 plugins/spec-skills/evals/effectiveness/harness.py package --run scratch/effectiveness/my-run
python3 plugins/spec-skills/evals/effectiveness/harness.py grade --run scratch/effectiveness/my-run
python3 plugins/spec-skills/evals/effectiveness/harness.py report --run scratch/effectiveness/my-run
```

`run` requires explicit case IDs and launches at most two subjects at once, keeping pairs adjacent. Every stage is a fresh CLI session. A disposable unborn Git repository prevents parent metadata leakage; no fixture or source commits are made. Its workspace retains earlier authored files and applies only the case's declared stage changes. Existing repeat directories are rejected; use a new run snapshot to reset reproducibly. Do not delete evidence to rerun in place. Each process has a timeout; auth/client errors remain blocked. A local host may require permission to initialize its CLI client even while subject commands remain sandboxed.

`current` supplies the frozen plugin; `none` supplies no task-specific guidance; `prior` supplies independent prior spec skills plus original Deep Design, with no new domain-planning skill. Defaults for prior sources match the originating workstation; override them elsewhere. Run manifests retain content hashes, CLI version, source revision, exact commands, usage where the host reports it, and elapsed time. The corpus and hidden rubric are frozen too. Case outputs never modify source skills.

Repository subjects actually read/write isolated files with their granted tools. Markdown-only subjects get all available repository text inline, must make zero tool calls, and return a review without claiming persistence. This demonstrates a constrained text workflow, not native Copilot integration or removal of every host tool. Triggers are deliberately marked description-selection proxies, not proof of automatic activation.

## Grade and compare

Give a fresh grader one `blind/<case-repeat-baseline>/` package and [GRADING.md](GRADING.md). Save its JSON as `grading.json` in that package; do not supply `blind-allocation.json`. The script randomizes A/B labels reproducibly. Artifact prose can reveal methods, so blinding is imperfect. Audit original raw traces separately for unauthorized tool use, extra skill loading, and claims of execution. The generated `REPORT.md` links responses and metadata; it never substitutes completion for semantic success.

For an interactive human review surface, export the retained artifacts to the upstream Anthropic viewer layout and use its static generator (Python 3.10+):

```sh
python3 plugins/spec-skills/evals/effectiveness/harness.py viewer-export --run scratch/effectiveness/my-run --output scratch/effectiveness/my-run-viewer
python3.10 /path/to/skill-creator/eval-viewer/generate_review.py scratch/effectiveness/my-run-viewer --skill-name design-specification --static scratch/effectiveness/review.html
```

The viewer includes stage prompts, real responses, before/after artifacts and measured run evidence. It does not invent a single pass-rate benchmark; dimension judgments and comparisons remain in the report. The static viewer can export human feedback, which remains separate from model grades. The helper is external tooling, not bundled or installed by this suite.

Pairwise grades are reviewable artifacts rather than an automatic quality gate. Record per-dimension variation, seeded true/false findings, authority errors, and useful uncertainty. Human preference remains pending until a human evaluates usefulness. Preserve raw traces in ignored scratch; promote substantive comparisons and evidence excerpts into the checked-in results record.

## Maintenance

Add observed failures as realistic cases, using fresh domains and counterexamples. Keep task prompts separate from hidden answer keys. Preserve holdouts for later versions; do not train all examples into skill prose. Freeze a new snapshot for each candidate. Repeat high-risk/ambiguous cases and report variance. Retire or strengthen checks that every competent baseline satisfies; existence checks may remain useful hygiene but cannot establish improvement.

Do not change skill behavior during a frozen baseline assessment. Propose supported improvements separately, then compare a new version on both regressions and reserved holdouts. Retain negative controls so stronger triggering or longer design procedures do not quietly make routine work worse.
