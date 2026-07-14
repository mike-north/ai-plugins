# Product-led Eng Fleet

A reusable operating model for running software delivery as a **fleet of autonomous coding
agents coordinated through a GitHub-issue work queue**.

- **PM** files self-contained, pickup-ready issues — the only PM→eng interface.
- **Orchestrator** runs the loop (sync → triage → claim → delegate → monitor → merge →
  reflect) and owns the review/merge cycle.
- **Implementers** each take one issue, build against its acceptance criteria, open a PR with
  `Refs #N`, and stop.

## The core idea

The hard part of coordinating a fleet is knowing the true state of the queue — what's ready,
what's ranked first, and who actually has what. That is a deterministic `git`/`gh`
computation, so it lives in a script, not in an agent's context window. Reasoning is reserved
for the irreducible judgment: ranking among ready issues, writing acceptance criteria,
reviewing PRs, and deciding to merge.

Just as importantly, every GitHub **write** the loops need goes through a small set of
**bounded scripts with no arbitrary-`gh api` escape hatch** — so each can be pre-approved
(allowlisted) and run autonomously, while raw `gh api` stays human-gated. The scripts are the
security boundary.

## Components

- **Skill** `product-led-eng-fleet` — the operating model + routing
  (`resources/orchestrator-loop.md`, `fleet-conventions.md`, `issue-authoring.md`).
- **Agents** `eng-orchestrator` (loop driver) and `fleet-implementer` (one issue → PR → stop).
- **Commands** `/eng-loop`, `/queue`, `/file-issue`.
- **Rules / steering** — the fleet conventions as standing directives.

## Requirements: the bounded GitHub scripts

The deterministic GitHub I/O is the companion **`github-fleet-tools`** plugin, invoked by name (symlink its scripts onto your PATH):

```
# detection (read-only — already safe to allowlist)
gh-queue list               # ranked ready queue (deadline → priority → number)
gh-queue ground-truth <N>   # is #N safe to claim? exit 0 = safe, 2 = blocked
gh-queue status             # ready / in-progress / open-PR rollup

# response (bounded tools + gh-native verbs, allowlistable)
gh-label <N> add|remove <label>           gh issue comment <N> <body>
gh issue create --title … --body-file …   gh issue close <N>
gh pr comment <N> <body>                  gh pr ready <N>
gh pr create --title … --body-file …      gh-reviews reply / gh-reviews resolve
gh-merge <N> [--dry-run]                  # GUARDED + prompts by design (see below)
```

`gh-queue` is configurable per repo via `PLEF_*` env vars (label names, priority order,
staleness window). `gh-merge` is the one high-consequence write: it is configured to
prompt for approval (an `ask` permission — approve once per session to let the orchestrator
merge autonomously) and additionally refuses to merge unless the PR is open, non-draft,
not a release/Version PR, has a Copilot review present, and has passed required checks.
Requires `git` and an authenticated GitHub CLI (`gh`).

## Installation

Claude Code / Cursor: `/plugin marketplace add <owner>/<repo>` then install
`product-led-eng-fleet`. Codex: `codex plugin marketplace add <owner>/<repo>`.

## License

ISC
