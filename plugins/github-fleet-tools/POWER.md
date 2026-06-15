---
name: github-fleet-tools
description: Opinionated, allowlistable command-line tools for an agent to engage with GitHub.
version: 0.0.1
---

# GitHub Fleet Tools

Opinionated, allowlistable command-line tools for an agent to engage with GitHub.

## Overview

Five consolidated CLI tools let an agent work GitHub safely and autonomously:

- **`gh-reviews`** — PR review-thread inspection (CI rollup, merge state, unresolved threads,
  per-thread/reply status, inline-comment counts) plus the API-only reply/resolve mutations.
- **`gh-queue`** — read-only issue work queue: ranked ready queue + "safe to claim?"
  ground-truth check + ready/in-progress/open-PR rollup.
- **`gh-repo`** — read a file at a ref or list a compare range's changed files + stats, via
  the API, with no local checkout.
- **`gh-label`** — bounded single-label edit (claim / release), the granular affordance over
  broad `gh issue edit`.
- **`gh-merge`** — guarded squash-merge that refuses release/draft/un-reviewed PRs and PRs
  with failing required checks.

Each custom tool is **compound, API-only, guarded, or permission-scopable** — never a bare
shadow of a `gh` porcelain command. Six operations were intentionally dropped to `gh`-native
verbs (`gh issue comment`/`close`/`create`, `gh pr comment`/`ready`/`create`). You can
allowlist exactly these commands and keep raw `gh api` gated. This is the tooling layer
beneath the product-led-eng-fleet methodology. Requires `git` and an authenticated GitHub
CLI (`gh`).
