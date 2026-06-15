# GitHub Fleet Tools

Opinionated, allowlistable command-line tools for an agent to engage with GitHub.

## Overview

A deterministic tool surface that lets an agent work GitHub safely and autonomously:

- **Read-only**: PR health (CI + merge state + unresolved review threads), a ranked
  GitHub-issue work queue with a "safe to claim?" ground-truth check, and review-thread status.
- **Bounded writes**: label, comment, reply-to/resolve review threads, create issue/PR, mark
  ready — one `gh` operation per script, no arbitrary-API escape hatch.
- **Guarded merge**: refuses release/draft/un-reviewed PRs and PRs with failing required checks.

Because each tool is a single bounded `gh` operation, you can allowlist exactly those commands
and keep raw `gh api` gated. This is the tooling layer beneath the product-led-eng-fleet
methodology. Requires `git` and an authenticated GitHub CLI (`gh`).
