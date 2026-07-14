---
name: review
description: >
  Adaptive, host-neutral code review. Detects the project's stack, routes to specialist
  reviewer lenses, dispatches each as an agent with its own context window, and records
  findings — and mechanical fixes captured straight from real worktree edits — as SARIF.
  Use when asked to review code changes, a branch, a diff, or a PR. Findings-only: posting a
  GitHub review is the separate `publish-pr` skill.
user-invocable: true
---

# Code Review

## Capability envelope (read first)

- **Findings are recorded, never hand-authored.** Every finding goes through
  `record-finding.mjs`. Reviewers never write SARIF, a `\`\`\`suggestion` fence, or a diff by hand.
- **A mechanical fix is a real edit, not a description.** If a finding has an obvious, safe fix,
  make the actual edit in the worktree, then call `record-finding.mjs --fix-from-worktree` — it
  captures the edit you just made via snapshot subtraction and turns it into a SARIF `fix`. Never
  fabricate a "fix" as prose or a suggestion block; if you didn't edit the file, don't attach a fix.
- **Reviewers never commit and never post.** Staging, committing, and posting to GitHub are
  handled outside this skill (posting is `publish-pr`).
- **Always run the script — never hand-assemble.** Every step below has a deterministic tool.
  Doing its job by hand (grepping for stack facts, computing a lens roster, writing SARIF,
  formatting a report) produces output this pipeline can't trust downstream.

Let `$SKILL` be this file's directory (`${CLAUDE_PLUGIN_ROOT}/skills/review` in Claude Code).

## Exit codes (all `scripts/*.mjs`)

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | unexpected error |
| 2 | usage error (bad/missing flags) |
| 3 | validation failed (bad finding JSON, or worktree not clean for `review-init`) |
| 4 | drift — HEAD moved, an uncaptured edit exists, or a fix overlaps another finding's hunk without `--amend`. Surface the message verbatim; don't paper over it. |

## Flow

**0. Resolve the target.** Reviewing a PR: use the `workspace` skill first (`worktree.sh for-pr
<N>`, then `setup`, then `EnterWorktree`) so review runs against an isolated worktree, not the
user's checkout. Reviewing your own working diff: skip workspace setup, operate on the current
repo as the "worktree".

**1. Facts.** `node $SKILL/scripts/signals.mjs [--root <dir>] [--base <ref>]` → JSON facts
(changed files, manifests, deps, diff shape, remote host). No lens names — just facts.

**2. Route.** `node $SKILL/scripts/route-lenses.mjs --signals -` (pipe step 1's output) →
`{roster, judgment_candidates, skipped}`. You may add a `judgment_candidates` lens to the roster,
but only with a one-line stated reason tied to its `summon` text. Honor any user-stated `--with`/
`--without` pins exactly — they are guaranteed, not suggestions. Cap total spawned lenses at 5.

**3. PR context (pre-step, not a lens).** If a PR is in play, fetch its description and any
linked issues yourself (`gh pr view <N> --json title,body,...`) and pass that as shared read-only
context to every reviewer prompt in step 5. It is context for judgment, not a source of findings.

**4. Start the session.** `node $SKILL/scripts/review-init.mjs --work-area <dir> --worktree
<dir> [--repo o/r --pr N --host h]` — asserts the worktree is clean, snapshots the baseline, and
writes `state.json`. Work area default: `scratch/code-review/<id>/` (or the host's scratchpad).
If PR metadata is available (from `$(git rev-parse --git-dir)/review-meta.json` inside the worktree), pass it through.

**5. Dispatch.** Spawn one subagent per rostered lens **in parallel** when your host supports it.
Fall back to running lenses sequentially yourself only when you can't spawn subagents, or when
the diff is small (<200 changed lines and ≤2 rostered lenses) and parallel overhead isn't worth it.

**Fixes are single-writer.** Snapshot capture attributes each fix as the delta since the previous
snapshot, so two reviewers editing the shared worktree concurrently entangle each other's edits
(reviewer A's snapshot sweeps in reviewer B's in-flight edits). Parallel reviewers must therefore
review **findings-only**; tell them to hold mechanical fixes and list them in their final message.
After the parallel wave, apply the held fixes **one reviewer at a time** (edit → record
`--fix-from-worktree` → next), or re-dispatch each fix-holder sequentially. Only a solo/sequential
reviewer may fix-as-it-goes.

Each subagent's prompt (~10 lines):

> You are reviewing this change through the **`<lens>`** lens: read `$SKILL/lenses/<lens>.md`
> for your charter and scope. Load these packs for extra domain facts: `<resolved pack paths,
> or "none">`. Project conventions, if present: `<repo CLAUDE.md / .claude/review.md path>`.
> Shared context: `<signals excerpt + PR description/issues, if any>`. Work area:
> `<work-area>`. Your reviewer id: `<lens>`.
>
> Read the diff and source; find issues in your lens's charter only. For each: if it has an
> obvious, safe fix, make the real edit in the worktree, then run
> `node "$SKILL/scripts/record-finding.mjs" --work-area "<work-area>" --reviewer "<lens>" \
> --fix-from-worktree --json '{"ruleId":"...","severity":"critical|important|suggestion",
> "confidence":"high|medium|low","scope":"line|file|pr","message":"why this matters","file":"...",
> "startLine":N,"endLine":N,"fixDescription":"..."}'`. For a non-mechanical finding, omit
> `--fix-from-worktree`. If your edit overlaps a hunk another finding already captured,
> `record-finding` exits 4 — re-run with `--amend <findingId>` to merge into that finding, or
> back out your edit if it wasn't actually needed.

**6. Build-the-totality gate.** After all reviewers finish, if any fixes were captured, run the
project's own build/lint/test on the worktree. A failing fix must be repaired (edit again, then
`record-finding --amend <findingId> --fix-from-worktree`) or its fix removed — never leave a
captured fix that doesn't build.

**7. Merge.** `node $SKILL/scripts/merge-findings.mjs --work-area <dir> [--allow-unattributed] -o
merged.sarif.json`. This is also where drift is caught: an exit-4 here means the HEAD this review
was based on moved, or the worktree has edits no finding accounted for. Surface that message
verbatim to the user — don't silently retry or discard it.

**7a. Dedupe backstop (judgment).** The mechanical dedupe only folds findings whose messages
share vocabulary; two reviewers describing the same defect in different words survive it. Skim
the merged results for same-region near-duplicates and, before rendering/posting, keep the
better-written one (note the other reviewer in your summary). Do this by editing your triage
choice, not the SARIF: re-run merge after removing the weaker finding's entry from its reviewer
log with `record-finding`-recorded ids in mind — or simply accept both when genuinely uncertain.

**8. Render.** `node $SKILL/scripts/render-review.mjs --sarif merged.sarif.json --format
markdown` for chat/orchestrator output. Posting the review to GitHub is the `publish-pr` skill's
job, not this skill's — hand it the same `merged.sarif.json` and the PR URL.

When the session is fully done with a work area (published or the user is finished with a local
review), `node $SKILL/scripts/review-cleanup.mjs --work-area <dir>` removes its snapshot refs and
lock — it does not delete the work area's `state.json`/`findings/` (left for inspection) or the
worktree itself (the `workspace` skill's `remove` handles that).

## Invocation shapes

1. **Own working diff.** Skip step 0's workspace setup; `--worktree` is the current repo root;
   omit `--repo`/`--pr`/`--host` from `review-init`.
2. **PR review.** Step 0 creates and enters an isolated worktree; `review-init` and `publish-pr`
   both read PR identity from `$(git rev-parse --git-dir)/review-meta.json`.
3. **Subagent-returns-markdown.** When a host invokes this skill itself as a subagent (rather
   than as the top-level orchestrator), run steps 0–8 sequentially in one context and return step
   8's markdown as your response instead of presenting it interactively.
