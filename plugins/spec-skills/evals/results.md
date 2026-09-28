# Local validation results

September 27, 2026. These observations apply to the local implementation evolved from marketplace revision `52d92cef2f7e08dba16193dd431d2ba0d63bcf2c`. They do not establish agent reliability, exhaustive design assurance, or live host activation.

## Mechanical validation

- Locked dependencies installed in the isolated clone with a clone-local store and lifecycle scripts disabled: aipm CLI 0.5.0, core 0.8.0, Vitest 4.0.18. The original checkout and its dependencies were not modified.
- `pnpm check`: full marketplace build and validation passed. Generation changed only the two marketplace descriptions/tags relevant to `spec-skills`; the unchanged Codex registration retains its existing plugin identity.
- `pnpm exec aipm lint . --format text`: no findings. Plugin-scoped invocation produces spurious partial-discovery registry freshness warnings in this toolkit version; use the workspace-root invocation for registry checks.
- `pnpm lint`: repository-wide Markdown lint passed.
- Skill-creator `quick_validate.py`: all four skill folders passed.
- `claude plugin validate plugins/spec-skills`: passed with the existing optional-author-metadata warning. `claude --help` confirms session-only `--plugin-dir` loading; no plugin was installed and no live assistant session was launched through that host.

The optional review-input helper has 19 integration cases using real disposable Git repositories, including literal filenames, missing/staged/ignored content, historical revisions, linked-worktree selection, symlink/directory/submodule rejection, invalid input, non-mutation, inherited Git selectors, and missing partial-clone trees. Tests preceded implementation: the initial suite failed before the helper existed; the partial-clone test later exposed Git's lazy fetch, which was explicitly disabled. No document contents are read by the helper. Tested runtime: Node.js 24.14.0 and Apple Git 2.54.0; older runtime behavior is not separately verified.

## Broad-suite limitation reproduced on baseline

The first `pnpm test` run had 549 passing tests and 12 failures in two unchanged `code-review` CLI test files. Both CLI entrypoints compare `import.meta.url` with an unescaped filesystem path, so they skip their entrypoint under this checkout's path containing spaces.

All 12 failures reproduced against `git archive HEAD` baseline sources in an isolated fixture: 66 passing and 12 failing tests across those same two files. No source under `plugins/code-review` changed. These failures are not attributed to the specification plugin, and fixing the other plugin is outside this change. The new helper avoids that entrypoint pattern.

## Behavioral evaluation scope

The prewritten [scenario rubric](scenarios.md) defines the intended outcomes. An independent agent receives realistic requests and raw isolated project files, not the rubric, governing proposal, implementation history, or expected answers. It actually authors/reviews/resumes within those fixtures; a Markdown-only case receives only its repository adapter and supplied revision.

| Case | Observed outcome |
| --- | --- |
| Product discovery | Proposed a unifying customer-use model with assumptions, sacrifice, counterexamples, and a pending human decision; saved the project sketch and separate checkpoint. Did not infer pinned adoption merely from unchanged configuration. |
| Authoring from an existing plan | Added a contract and implementation handoff linked to particular plan and decision sections; kept replacement-configuration and concurrency choices unresolved rather than inventing them. |
| No-spec audit | Reported absent governing intent, described only supported code behavior, authored bounded candidate alternatives, and left a discoverable resumption condition. Did not ratify a test's current expectation. |
| Saved audit resumed after an explicit decision | Recorded the supplied fictional user's newly accepted pinned-usage choice, developed the same contract, and resumed comparison against it. Distinguished returned-state divergence from unexamined persistence and did not allege historical regression. |
| Repository adapter review | Identified an accepted evaluator responsibility mismatch and a conditional rejection/latency concern, with evidence and limits. Did not demand separate classes or treat future retries as a current defect. The inventory deviation below limits the portable-mode trial. |
| Stale checkpoint and campaign preference | Reconciled the checkpoint with the newer accepted adoption decision, reused the repository's Markdown campaign instead of the personal issue-based default, and preserved the unresolved compatibility question. |
| Compression reconsideration | Recognized the accepted decision's independent-change trigger, proposed separate policy/routing concepts, preserved the old decision/contract pending acceptance, and identified migration uncertainty. |
| Inaccessible campaign service | Kept the existing campaign authoritative, saved explicitly unsynchronized investigation notes, and made no false external update claim. |
| Separate worktrees | Continued B's own inquiry in B; did not read or alter A's personal record or silently centralize state. |
| Explicitly shared worktree state | Resolved the permitted link, updated B's distinct shared record with B's checkout context, preserved A's record and the chosen sharing arrangement. |
| Unavailable linked state | Inspected the link without accessing its unavailable target, disclosed missing recovery context, and saved a local unsynchronized continuation draft without replacing the selected shared index or claiming a recovered decision. |

These ten initial cases plus the resumed audit produced no material contradiction requiring a skill revision. They do not imply that every plausible input will succeed. Model-derived compatibility proposals were labeled as such, and missing code or runtime evidence stayed missing. The primary journey was sampled through discovery, a developed plan, contract authoring, implementation handoff, and review of supplied code; an entire product was not implemented during this evaluation.

The subject disclosed one procedural deviation: a general fixture inventory read case 04's Git revision/status before its substantive review. The substantive finding used the supplied adapter and files, without plugin helpers or delegation, but this was not a strictly metadata-free Markdown-only execution. That limitation is retained rather than reporting a clean portable-mode trial. A guessed checkpoint filename also caused a harmless read error; following the actual work index recovered the correct record.

This is one subject executing a series of independent fictional cases in one agent session, not repeated trials or a blind fresh model for every stage. The fixtures include existing accepted decisions, missing decisions, and stale checkpoints. Live issue-tracker access, cross-machine continuation, crash recovery, host trigger accuracy, and native subagent dispatch are not exercised. Unavailable state/service cases are supplied access limits, not a test of operating-system sandbox enforcement. There is no guarantee that an abrupt interruption preserves unsaved conversation state.

Detailed run outputs stay in the clone's ignored `scratch/forward-eval/` working area. Only this concise, review-relevant record and the reusable scenario rubric ship with the plugin.
