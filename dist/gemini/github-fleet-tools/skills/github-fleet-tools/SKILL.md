---
name: github-fleet-tools
description: >-
  Opinionated, allowlistable command-line tools for engaging with GitHub from an agent —
  a read-only PR/issue-queue inspection layer plus bounded write verbs (label, comment,
  reply/resolve review threads, create issue/PR, mark ready, guarded merge). Use when an
  agent needs to triage a GitHub-issue work queue, check PR/CI/review health, respond to
  review feedback, open issues or PRs, or merge — and whenever you'd otherwise reach for
  raw `gh api`. Each tool wraps exactly one `gh` operation with no arbitrary-API escape
  hatch, so it can be pre-approved and run autonomously while raw `gh api` stays gated.
---

# GitHub fleet tools

A deterministic, **opinionated tool surface** for letting an agent engage with GitHub
safely and autonomously. The premise: an agent coordinating work on GitHub repeatedly needs
a *small, fixed* set of operations (read the queue, check a PR, reply to a review, open an
issue/PR, merge). Wrapping each as a **bounded script with no arbitrary-`gh api` escape
hatch** lets you allowlist exactly those operations — the loop runs without permission
stalls, while raw `gh api`/`gh issue edit`/`gh pr merge` stays human-gated.

> This is the *tooling* layer. The *methodology* that drives these tools into a
> PM/orchestrator loop lives in the **product-led-eng-fleet** plugin, which depends on this one.

## The doctrine

- **Detect with code, not context.** Queue/PR/review state is a deterministic `git`/`gh`
  computation — never have the agent re-pull and diff issues in its own context window.
- **Every write goes through a bounded verb.** One `gh` mutation per script, validated
  inputs, no passthrough to arbitrary API. The script *is* the security boundary.
- **Merge is special.** It is the one high-consequence write and is never auto-approved;
  it prompts, and even when approved it refuses anything unsafe (see below).

## Setup (invocation + allowlisting)

Scripts live in `scripts/` alongside this skill (`skills/github-fleet-tools/scripts/`). Two ways to call them:

- **By path:** `${CLAUDE_PLUGIN_ROOT}/skills/github-fleet-tools/scripts/<name>` — portable, works anywhere.
- **By name (recommended):** symlink them onto your `PATH` (e.g. `ln -s <plugin>/skills/github-fleet-tools/scripts/* ~/bin/`)
  and call them bare — `gh-queue.mjs list`, `pr-merge.sh 10`. Bare names give **stable
  allowlist entries** that don't churn with the plugin's install path or version.

Allowlist the read tools and bounded writes (auto-approve); leave `pr-merge.sh` as **ask**
(prompt once, then "Always Allow" per session); keep raw `gh api` gated. Bare-name rules:

```jsonc
// settings.json → permissions
"allow": [
  "Bash(gh-queue.mjs:*)", "Bash(pr-status.sh:*)", "Bash(pr-thread-status.sh:*)",
  "Bash(pr-review-comment-count.sh:*)", "Bash(pr-reply-resolve.sh:*)",
  "Bash(pr-resolve-threads.sh:*)", "Bash(gh-changed-files.sh:*)", "Bash(gh-file-at.sh:*)",
  "Bash(issue-label.sh:*)", "Bash(issue-comment.sh:*)", "Bash(issue-close.sh:*)",
  "Bash(issue-create.sh:*)", "Bash(pr-comment.sh:*)", "Bash(pr-ready.sh:*)", "Bash(pr-create.sh:*)"
],
"ask":  [ "Bash(gh api:*)", "Bash(pr-merge.sh:*)" ]
```

All scripts honor `GH` (override the `gh` binary) and `GH_HOST` (force a hostname). They
require `git` and an authenticated GitHub CLI (`gh`).

## Detection (read-only)

- **`pr-status.sh [PR]`** — PR health: CI check rollup, merge state
  (`mergeable`/`mergeStateStatus`/`reviewDecision`/draft), and **unresolved review threads
  with each thread's first-comment `databaseId`** (the id the reply/resolve tools consume).
- **`gh-queue.mjs <list|ground-truth N|status>`** — issue work-queue engine. `list` = ranked
  ready queue (deadline → priority label → number); `ground-truth N` = is #N safe to claim?
  (exit 0 safe / 2 blocked by open PR or active claim); `status` = ready/in-progress/open-PR
  rollup. Configurable via `PLEF_*` env (`PLEF_INPROGRESS_LABEL`, `PLEF_EXCLUDE_LABELS`,
  `PLEF_PRIORITY_LABELS`, `PLEF_STALE_HOURS`). Invoke by name/path, not `node <path>`, so the
  allowlist matches.
- **`pr-thread-status.sh <PR> [COMMENT_ID…]`** — per-thread resolved/reply status; with ids,
  exit 2 if any still needs action (so a monitor-driven loop skips already-handled threads).
- **`gh-changed-files.sh (<PR> | <base>...<head>) [--repo owner/name] [--json]`** — changed
  files + line stats for a PR or compare range, via the API (any repo, no local checkout). The
  remote complement to the `git` plugin's local `diff-stats.sh` (that one aggregates
  review-effort line counts from a checkout; this one is per-file status for any PR/ref). Refs
  resolve server-side.
- **`gh-file-at.sh <ref> <path> [--repo owner/name]`** — print a file's contents at a ref
  (commit/branch/tag) — the remote analog of `git show <ref>:<path>`. (Contents API caps ~1 MB.)
- **`pr-review-comment-count.sh [PR] [author]`** — inline review-comment totals + resolved/
  unresolved thread split; `unresolved: 0` with a completed reviewer = "feedback acted on".

## Response (bounded writes — one verb each)

```bash
issue-label.sh <N> add|remove "in progress"        # claim / release
issue-comment.sh <N> "<body>" | --body-file <path|->
issue-create.sh --title <T> --body-file <path|-> [--label L]...
issue-close.sh <N> ["<summary>" | --body-file <path|->]
pr-comment.sh <N> "<body>" | --body-file <path|->
pr-ready.sh <N>                                    # draft → ready
pr-create.sh --title <T> --body-file <path|-> [--base B] [--head H] [--draft] [--reviewer U]...
pr-reply-resolve.sh <PR> <THREAD_COMMENT_ID> ["<reply>"]   # reply to + resolve one thread
pr-resolve-threads.sh <PR> [--dry-run]             # resolve every addressed thread at once
```

All reject empty/invalid input (exit 2) and pass long bodies via `--body-file` (or `-` for
stdin) so multi-line Markdown survives shell quoting.

## Guarded merge — `pr-merge.sh <N> [--dry-run]`

Squash-only, never deletes the branch. **Configured as `ask`** (never auto-approved): the
first call in a session prompts — choose "Always Allow" to let that session merge thereafter.
Even when approved it **refuses** (exit 3) unless the PR is open, non-draft, **not a
release/Version PR**, has a **reviewer review present** (latest verdict ≠ changes-requested),
and has **passed required checks** (`gh pr checks --required` clean). `--dry-run` evaluates the
guards and reports without merging. Tune the reviewer match and release-PR patterns with
`PLEF_COPILOT_LOGIN_RE`, `PLEF_VERSION_TITLE_RE`, `PLEF_VERSION_BRANCH_RE`.

## GitHub engagement steering

- **Reply to every review comment before merge** — what you changed, or why you respectfully
  didn't. Resolve threads you've addressed; never bulk-resolve un-addressed feedback (it hides
  it — `pr-resolve-threads.sh --dry-run` first).
- **Before acting on a replayed review comment, check `pr-thread-status.sh`** — don't
  double-reply to a thread that's already resolved.
- **Reference issues with `Refs #N`, not `Closes`/`Fixes`** unless the PR truly completes the
  issue — closing keywords close tracking issues out from under a queue.
- **Never touch release/Version PRs**, and never reach for raw `gh api` when a bounded verb
  covers the need.
