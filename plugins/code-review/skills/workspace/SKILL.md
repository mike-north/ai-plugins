---
name: workspace
description: >
  Create an isolated git worktree for review or feature work, bootstrap its
  dependencies, and switch the current session into it. Use when asked to set
  up a review worktree, create a worktree for a PR, or get an isolated
  workspace for feature work — before checking out a PR branch or starting
  work that shouldn't touch the current checkout.
user-invocable: true
---

# Workspace

Isolated worktrees live at `<repo-root>/.claude/worktrees/<name>` — the
convention the native `EnterWorktree` tool expects, never `.worktrees/` and
never the main checkout. **Always run `worktree.sh` — never hand-assemble
`git worktree` commands.** It is idempotent, finds the main repo root even
when already inside another worktree, and keeps `.claude/worktrees/`
gitignored without touching the project's own `.gitignore`.

Let `$SKILL` be this file's directory (`${CLAUDE_PLUGIN_ROOT}/skills/workspace`
in Claude Code).

## The three-step flow

1. **Create the worktree.**
   - Feature work: `bash $SKILL/scripts/worktree.sh create <name> [ref]`
   - Reviewing a PR: `bash $SKILL/scripts/worktree.sh for-pr <pr-number-or-url>`
     — writes `<worktree>/.claude/review-meta.json` (pr, host, owner, repo,
     headSha, headRef, baseRef, baseSha).
   Both print the worktree path and are safe to re-run: a clean,
   already-correct worktree is reused; a stale one is replaced; a dirty one is
   refused rather than silently discarded.

2. **Bootstrap dependencies.**
   `bash $SKILL/scripts/worktree.sh setup <worktree-dir>` runs the worktree's
   own `.claude/worktree-setup.sh` if present; otherwise it only **prints**
   `RUN: <command>` lines inferred from manifest files (pnpm/npm/yarn lockfile,
   Cargo.toml, go.mod, pyproject.toml+poetry.lock, requirements.txt). Actually
   run each printed command yourself, under normal permissions — the script
   never executes installs on your behalf.

3. **Switch the session in.**
   Call `EnterWorktree` with the path from step 1. Reviewers/subagents spawned
   *after* entering inherit the worktree as their cwd; ones already running do not.

## Other operations

- `list` — worktrees under `.claude/worktrees/`.
- `remove <name-or-path> [--force]` — refuses if dirty unless `--force`;
  deletes the branch once merged, or always for `review-pr-<N>` branches.
