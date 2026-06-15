# Product-led eng fleet — steering

Guidance for running or joining an engineering fleet coordinated through a GitHub-issue
work queue. The full operating model lives in the `product-led-eng-fleet` skill; this is the
always-available steering summary.

## Roles

- **PM** files self-contained, pickup-ready issues — the only PM→eng interface.
- **Orchestrator** runs the loop (sync → triage → claim → delegate → monitor → merge →
  reflect) and owns the review cycle.
- **Implementers** take one issue each, build against acceptance criteria, open a PR, and stop.

## Non-negotiables

- Detect the queue with `gh-queue.mjs` (in `~/.claude/skills/git/scripts/`), not by reasoning
  over issues in context; `git fetch` before trusting any local state. Do writes through the
  bounded scripts there (label/comment/create/merge), never raw `gh api`.
- Ground-truth before claiming — never duplicate an open PR or an active claim.
- Acceptance criteria are the contract; map each to a named test in the PR.
- Reference issues with `Refs #N`, never closing keywords, unless the PR truly completes it.
- Implementers stop at PR-open; the orchestrator runs review and fixes.
- Format before every push; reply to every review comment before merge.
- Never touch release/Version PRs, flip visibility, publish locally, or modify secrets.
- Keep internal codenames out of public-facing content.
