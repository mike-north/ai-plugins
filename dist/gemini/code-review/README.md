# Code Review

Adaptive, host-neutral code review. Detects the project's stack, routes the change to
specialist reviewer **lenses**, dispatches each as an agent with its own context window, and
records findings as [SARIF](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html).

## Design

A three-phase pipeline whose phases share only an on-disk **work area**:

1. **set up work area** *(future phase)* — normalize the changes under review.
2. **review** *(this plugin's `review` skill)* — analyze the diff through lenses, emit raw findings.
3. **structure findings** *(future phase)* — deduplicate, triage, and render to a destination
   (local display, GitHub PR review).

Two principles shape it:

- **Mechanical work lives in deterministic code.** Reviewer agents only judge *whether*
  something is a problem and *why*. Building SARIF, validating line numbers against the real
  files, encoding suggested fixes, and rendering summaries are done by the scripts in
  `skills/review/scripts/` — agents never hand-author JSON or formatted output.
- **Suggested changes are structured edits, not Markdown ` ```suggestion ` blocks** — captured
  as SARIF `fixes` (region + replacement) so a downstream phase can turn them into GitHub
  suggestions deterministically.

## What ships

- `skills/review/SKILL.md` — the host-neutral orchestrator.
- `skills/review/resources/lenses/*.md` — 11 reviewer personas (api-design, architecture, cli,
  code-quality, domain-modeling, go, pr-context, ruby, simplicity, tests, typescript).
- `skills/review/resources/*.md` — supplemental, stack-specific knowledge files.
- `skills/review/scripts/` — `detect-stack.sh`, `git-context.sh` (routing + diff) and
  `record-finding.mjs`, `render-findings.mjs`, `sarif.mjs` (deterministic findings tools).

## Usage

Invoke the `review` skill on a branch or working-tree change. It creates a work area under
`scratch/code-review/<id>/`, routes to the relevant lenses, records per-lens findings as SARIF,
and prints a summary. The work area persists for a downstream structuring phase.

## Status

v1 is **findings-only and static**: reviewers read the diff and source and report findings;
they do not edit files or run build/lint/test. Executable validation, GitHub PR conversion,
and feedback loops are planned later phases.

## License

ISC
