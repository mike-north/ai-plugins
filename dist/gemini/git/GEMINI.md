# Git Utilities

Deterministic local-git utilities: exact diff statistics and a stacked-PR manager.

## Overview

Local-VCS tooling for agents (no GitHub auth required):

- **`diff-stats.sh`** — exact change metrics between two refs: meaningful (generated-file-
  excluded) vs raw line counts, and an implementation-vs-test split. PR size is computed, not
  estimated.
- **`gst`** — stacked-PR manager for chains of dependent branches: create, list, restack,
  submit (push + create/update PRs), navigate, adopt, orphan; metadata in git config.

Plus worktree-discipline guidance for working a branch stack. See `skills/git/SKILL.md`.
