---
name: github-fleet-tools
description: >-
  Opinionated, allowlistable command-line tools for engaging with GitHub from an agent —
  five consolidated CLI tools: gh-reviews (PR review-thread inspection + reply/resolve),
  gh-queue (read-only issue work-queue engine), gh-repo (read a file at a ref / list a
  compare range), gh-label (bounded single-label edit), and gh-merge (guarded squash-merge).
  Use when an agent needs to triage a GitHub-issue work queue, check PR/CI/review health,
  respond to review feedback, or merge. Each tool is compound, API-only, guarded, or
  permission-scopable — never a bare shadow of a `gh` porcelain command — so it can be
  pre-approved and run autonomously while raw `gh api` stays gated.
---

# GitHub fleet tools

A deterministic, **opinionated tool surface** for letting an agent engage with GitHub
safely and autonomously. The premise: an agent coordinating work on GitHub repeatedly needs
a *small, fixed* set of operations (read the queue, check a PR, reply to a review, edit a
label, merge). Each custom tool earns its place against a strict rubric (below); everything
that would just shadow a `gh` porcelain command is **deleted** in favor of the native verb.

> This is the *tooling* layer. The *methodology* that drives these tools into a
> PM/orchestrator loop lives in the **product-led-eng-fleet** plugin, which depends on this one.

## The rubric — when a custom tool is justified

A custom script in this plugin is justified **only** if it is at least one of:

1. **Compound** — it collapses several `gh` calls / a GraphQL query into one token-efficient
   result (e.g. `gh-reviews status` = checks + merge state + unresolved threads in one shot).
2. **Missing** — no `gh` porcelain exists; it is API-only (e.g. resolving a review thread is
   a GraphQL mutation with no `gh pr` equivalent).
3. **Guarded** — it is a safety wrapper enforcing preconditions around a `gh` command
   (e.g. `gh-merge` refuses anything unsafe even when approved).
4. **Permission-scopable** — the bounded op can't be cleanly allow-listed off a broader `gh`
   command in target harnesses (e.g. `gh-label` gives label-only autonomy without granting
   the whole of `gh issue edit`).

Anything that fails all four just shadows `gh` and is removed. **Six operations were
intentionally dropped** in favor of `gh`-native commands — there is no custom wrapper for
them, and they are allowlisted directly:

| Dropped wrapper | Use instead       |
| --------------- | ----------------- |
| issue comment   | `gh issue comment`|
| issue close     | `gh issue close`  |
| issue create    | `gh issue create` |
| pr comment      | `gh pr comment`   |
| pr ready        | `gh pr ready`     |
| pr create       | `gh pr create`    |

## The doctrine

- **Detect with code, not context.** Queue/PR/review state is a deterministic `git`/`gh`
  computation — never have the agent re-pull and diff issues in its own context window.
- **Bounded verbs for the ops `gh` can't cleanly scope.** `gh-label` and `gh-merge` exist
  precisely because allow-listing them off `gh issue edit` / `gh pr merge` is messy.
- **Merge is special.** It is the one high-consequence write and is never auto-approved;
  it prompts, and even when approved it refuses anything unsafe (see below).

## Setup (invocation + allowlisting)

Scripts live in `scripts/` alongside this skill (`skills/github-fleet-tools/scripts/`) (extensionless, executable). Two ways to call
them:

- **By path:** `${CLAUDE_PLUGIN_ROOT}/skills/github-fleet-tools/scripts/<name>` — portable, works anywhere.
- **By name (recommended):** symlink them onto your `PATH` (e.g. `ln -s <plugin>/skills/github-fleet-tools/scripts/* ~/bin/`)
  and call them bare — `gh-queue list`, `gh-merge 10`. Bare names give **stable allowlist
  entries** that don't churn with the plugin's install path or version.

Allowlist the read tools, the gh-native verbs, and the bounded write tools (auto-approve);
leave `gh-merge` and raw `gh api` as **ask**:

```jsonc
// settings.json → permissions
"allow": [
  "Bash(gh-reviews:*)",
  "Bash(gh-queue:*)",
  "Bash(gh-repo:*)",
  "Bash(gh-label:*)",
  "Bash(gh issue comment:*)",
  "Bash(gh issue close:*)",
  "Bash(gh issue create:*)",
  "Bash(gh pr comment:*)",
  "Bash(gh pr ready:*)",
  "Bash(gh pr create:*)"
],
"ask": [
  "Bash(gh api:*)",
  "Bash(gh-merge:*)"
]
```

Note that **`gh issue edit` is deliberately NOT allowlisted** — label edits go through
`gh-label`, which gives label-only autonomy without granting broad issue-editing.

All tools honor `GH` (override the `gh` binary) and `GH_HOST` (force a hostname). They
require `git` and an authenticated GitHub CLI (`gh`).

## `gh-reviews` — PR review-thread inspection + reply/resolve

Compound reads plus the API-only resolve mutation, behind one allowlistable command.

```bash
gh-reviews status  [PR]                          # CI rollup + merge state + unresolved threads
gh-reviews threads <PR> [COMMENT_ID...] [--json] # per-thread resolved/reply status
gh-reviews count   [PR] [AUTHOR_SUBSTRING]       # inline review-comment totals + resolved split
gh-reviews reply   <PR> <THREAD_COMMENT_ID> [BODY]  # reply to + resolve one thread
gh-reviews resolve <PR> [--dry-run]              # resolve every unresolved thread at once
```

- **`status`** prints the CI check rollup, merge state
  (`mergeable`/`mergeStateStatus`/`reviewDecision`/draft), and **unresolved review threads
  with each thread's first-comment `databaseId`** (the id the reply tool consumes).
- **`threads`** reports per-thread resolved/reply status; with ids, exits **2** if any still
  needs action (so a monitor-driven loop skips already-handled threads).
- **`count`** gives inline review-comment totals + the resolved/unresolved thread split —
  `unresolved: 0` with a completed reviewer means "feedback acted on".
- **`reply`** posts a reply (skipped if BODY is omitted) then resolves the one thread
  (idempotent — no-op if already resolved).
- **`resolve`** clears every still-unresolved thread; **`--dry-run` first** — resolving an
  un-addressed thread hides it.

## `gh-queue` — read-only issue work-queue engine

```bash
gh-queue list                # ranked ready queue (deadline → priority label → number)
gh-queue ground-truth <N>    # is #N safe to claim? exit 0 = safe, 2 = blocked
gh-queue status              # ready / in-progress / open-PR rollup
```

All subcommands accept `--json`. Configurable per repo via `PLEF_*` env
(`PLEF_INPROGRESS_LABEL`, `PLEF_EXCLUDE_LABELS`, `PLEF_PRIORITY_LABELS`, `PLEF_STALE_HOURS`).
`ground-truth` fetches `origin`, cross-references open PRs + remote branches, and flags
stale claims. Invoke by name/path (not `node <path>`) so the allowlist matches.

## `gh-repo` — read a file at a ref / list a compare range (no checkout)

```bash
gh-repo file    <ref> <path> [--repo owner/name]            # like `git show <ref>:<path>`
gh-repo compare <base>...<head> [--repo owner/name] [--json] # changed files + line stats
```

- **`file`** prints a file's contents at any commit/branch/tag via the contents API
  (caps ~1 MB; larger files report an error).
- **`compare`** lists a compare range's changed files + line stats via the compare API —
  the remote complement to a local diff-stat. **Only ref ranges**, not PR numbers — for a
  PR's files, `gh pr view N --json files` covers it.

## `gh-label` — bounded single-label edit

```bash
gh-label <ISSUE_NUMBER> add|remove "<LABEL>"   # claim = add "in progress"; release = remove
```

Exactly one label mutation via `gh issue edit` — the granular affordance that lets you grant
label-only autonomy without allow-listing all of `gh issue edit`. Rejects non-numeric issue
numbers and bad operations (exit 2).

## `gh-merge` — guarded squash-merge — `gh-merge <N> [--dry-run]`

Squash-only, never deletes the branch. **Configured as `ask`** (never auto-approved): the
first call in a session prompts — choose "Always Allow" to let that session merge thereafter.
Even when approved it **refuses** (exit 3) unless every guard holds:

1. The PR is open and not a draft.
2. It is **not a release/Version PR**.
3. A matching reviewer has **successfully** reviewed it, and the latest successful review
   doesn't request changes. Copilot's "…encountered an error and was unable to review…"
   notices and dismissed reviews don't count.
4. Required checks have **passed** (`gh pr checks --required` clean).
5. **The review is fresh.** It was on the current head commit, or every edit pushed since
   is covered by it. Rebases and merges from the base branch are covered, and so are edits
   confined to generated/mechanical paths. Hunks that an automated judgement (TypeSafe's
   Jev model) confidently maps to the reviewer's own feedback, without going beyond it,
   are covered too. Anything else needs a fresh review:
   `gh pr edit <N> --add-reviewer @copilot`.

Every guard **fails closed**. A missing `TYPESAFE_API_KEY`, or an API, network, git, or `gh`
failure, refuses the merge with the reason. So does a binary, conflicted, or oversized
change. The merge is bound to the evaluated head (`--match-head-commit`), so a push between
check and merge is rejected. `--dry-run` evaluates the guards and prints the full freshness
verdict (per-hunk classification and scores) without merging.

When the head has moved past the review, run `gh-merge` **from a clone of the PR's
repository**: the freshness check compares commits with `git`, fetching missing ones from
`origin` (`PLEF_GIT_REMOTE`). It needs `node` on `PATH`. It also needs `TYPESAFE_API_KEY`,
but only when a hunk has to be judged. `gh-merge` never calls a secrets manager. Provide the
key in the agent's environment, for example by starting the agent session through a
secrets launcher that exports it (such as one wrapping the agent in your secrets manager's
`run` command).

Tune the reviewer match and release-PR patterns with `PLEF_COPILOT_LOGIN_RE`,
`PLEF_VERSION_TITLE_RE`, `PLEF_VERSION_BRANCH_RE`. `PLEF_FRESHNESS_IGNORE` sets the exempt
generated paths. It replaces the defaults, and a catch-all pattern is refused. Because it
loosens the gate, set it in human-controlled configuration, not per invocation. The design,
policy, thresholds, and calibration evidence are in
[references/review-freshness.md](references/review-freshness.md).

## GitHub engagement steering

- **Reply to every review comment before merge** — what you changed, or why you respectfully
  didn't. Resolve threads you've addressed; never bulk-resolve un-addressed feedback (it hides
  it — `gh-reviews resolve <PR> --dry-run` first).
- **Before acting on a replayed review comment, check `gh-reviews threads`** — don't
  double-reply to a thread that's already resolved.
- **Reference issues with `Refs #N`, not `Closes`/`Fixes`** unless the PR truly completes the
  issue — closing keywords close tracking issues out from under a queue.
- **Never touch release/Version PRs**, and never reach for raw `gh api` when a bounded verb
  or a gh-native command covers the need.
