---
name: git
description: >-
  Deterministic local-git utilities and stacked-branch management for agents: exact diff
  statistics (meaningful vs raw line counts, implementation vs test split) and a stacked-PR
  manager (gst) for chains of dependent branches. Use when asked about diff size, line
  counts, PR/change metrics, or about creating, listing, restacking, submitting, or
  navigating a branch stack. Always run the scripts for exact results — never estimate.
---

# Git utilities

Deterministic scripts for local git work. **Never estimate or approximate git statistics —
always run the appropriate script.** `diff-stats.sh` is purely local (no GitHub needed); `gst`
is also local for branch/stack management, but its PR-facing operations (`gst submit`, and the
PR-status column in `gst list`) call the `gh` CLI and require an authenticated GitHub CLI.

## Setup (invocation)

Scripts live in `scripts/` under this plugin. Call them by path
(`${CLAUDE_PLUGIN_ROOT}/scripts/<name>`) or symlink them onto your `PATH` (e.g. `~/bin`) and
call them by name — `diff-stats.sh`, `gst list`. Bare names give stable allowlist entries
(`Bash(diff-stats.sh:*)`, `Bash(gst:*)`) independent of the install path.

## Diff statistics — `diff-stats.sh [BASE] [HEAD]`

Exact change metrics between two refs (base auto-detects the merge-base of HEAD vs main/master).

```bash
diff-stats.sh                       # auto base, HEAD
diff-stats.sh origin/main           # base specified, head defaults to HEAD
diff-stats.sh origin/main feature   # both refs
```

Reports **raw totals** (all files), **meaningful totals** (excluding `linguist-generated`
files per `.gitattributes`), and an **implementation vs test** breakdown (test = path contains
"test"). When reporting PR size, always cite the meaningful total and the impl/test split — a
1000-line PR that's 600 lines of tests is very different from one with none.

## Stacked PR management — `gst`

A manager for chains of dependent branches (stacks). Metadata is stored as
`git config branch.<name>.stack-parent` in the repo; trunk auto-detects `main` > `master` >
`origin/HEAD`.

```bash
gst create <name>     # create a branch as a child of the current branch
gst list              # show the stack tree with ahead/behind counts + PR status
gst restack [--continue|--abort]   # rebase all stack branches onto updated parents
gst submit [--draft] [--fill] [--push-delay=N] [--no-delay]   # push + create/update PRs, inject stack tables
gst up [N] / gst down [N]           # navigate the stack (blocked if working tree dirty)
gst log               # git log per stack branch
gst adopt <branch>    # set <branch> as a child of the current branch
gst orphan <branch>   # remove stack metadata from <branch>
```

`gst list` marks the current branch with `*`, shows `N↑` commits ahead of parent / `N↓` behind
(needs restack), and each branch's PR status. `gst submit` pushes with a default 10s delay
between branches to avoid SSH throttling (min 3s; `--no-delay` to disable; failed pushes retry
once after 15s).

> **Reliable pushes to github.com:** SSH is sometimes throttled or blocked on restrictive
> networks. If `gst submit`/`git push` stalls or fails signing, add an HTTPS remote backed by a
> `gh` token and push over that instead — HTTPS + the `gh` credential helper avoids the SSH
> path entirely.

## Worktree discipline for stacks

Worktrees give each stack branch its own checkout; use them alongside `gst` (gst manages
metadata + PRs, worktrees manage the file layout).

1. **Always branch from the tip of the previous branch** — each worktree forks from where the
   previous branch finished, not from `main`. `gst create <child>` then
   `git worktree add .worktrees/<child> <child>`.
2. **Never merge between stack branches.** Each branch is a linear extension of its parent; if
   C needs A's work, branch C from A's tip (or restack onto A) rather than merging.
3. **Parallel branches sharing a parent** both fork from the parent's tip; linearize by rebasing
   one onto the other when done.
4. **Commit + verify before creating the next worktree** — build/test, commit, then branch the
   next from that commit.
5. **Location convention:** `.worktrees/<branch-name>` in the repo root; add `.worktrees/` to
   `.gitignore`.

## Rules

1. **Never estimate line counts.** "How big is this PR?" → run `diff-stats.sh`. Don't count
   manually or guess from the diff.
2. **Always report meaningful totals** (excluding generated files) — that's what matters for
   review effort; raw totals are informational.
3. **Distinguish implementation from tests** when reporting PR size.
