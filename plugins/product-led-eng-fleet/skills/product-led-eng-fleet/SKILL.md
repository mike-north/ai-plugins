---
name: product-led-eng-fleet
description: >-
  Use when running or joining a product-led engineering fleet — a PM/orchestrator
  loop that ships work by filing self-contained GitHub issues, and implementer
  sub-agents that pick those issues up, build against acceptance criteria, and open
  PRs. Triggers on "run the eng loop", "pick up an issue", "triage the queue",
  "file a pickup-ready issue", "who is working on what", or coordinating multiple
  autonomous coding agents over a GitHub-issue work queue.
---

# Product-led engineering fleet

A reusable operating model for running software delivery as a **fleet of autonomous
coding agents coordinated through a GitHub-issue work queue**. It has three moving parts:

- **The PM** files _self-contained, pickup-ready issues_ — issues are the only
  PM→eng interface, and anything not filed as an issue never gets built.
- **The orchestrator** runs a per-iteration loop: sync → triage → claim → delegate →
  monitor → merge → reflect. It owns the review/merge cycle, not the implementers.
- **Fleet implementers** each take _one_ issue, build against its acceptance criteria
  in an isolated worktree, open a PR, and **stop** — the orchestrator drives review.

## The core discipline: detect with code, decide with judgment, act through bounded tools

The expensive, error-prone part of coordinating a fleet is _knowing the true state of
the queue_ — what's ready, what's ranked first, and "who actually has what." That is a
**deterministic git/gh computation**, not a judgment call. Never make an agent the
detector (no loop that re-pulls and diffs issues in its context window; no reliance on a
stale local checkout).

This pattern's GitHub I/O is a set of **bounded, allowlistable scripts** — the companion
**`github-fleet-tools`** plugin (install it alongside this one). They split
cleanly along the agent's boundary:

**Detection (read-only) — `gh-queue.mjs`:**

- `gh-queue.mjs list` — the ranked ready queue (deadline → priority label → issue number).
- `gh-queue.mjs ground-truth <N>` — is #N safe to claim? Fetches `origin`, cross-references
  open PRs and remote branches, flags stalled claims. Exit 0 = safe, 2 = blocked.
- `gh-queue.mjs status` — ready / in-progress / open-PR rollup.

**Response (bounded writes) — one verb per script, each wrapping a single `gh` mutation
with no arbitrary-API escape hatch, so they can be pre-approved and run autonomously:**

- claim/release: `issue-label.sh <N> add|remove "in progress"` (+ `issue-comment.sh` for intent)
- coordinate: `issue-comment.sh` · `pr-comment.sh` · `pr-reply-resolve.sh` · `pr-resolve-threads.sh`
- create: `issue-create.sh` (PM) · `pr-create.sh` · `pr-ready.sh`
- finish: `issue-close.sh` · `pr-merge.sh` (guarded; **prompts by design** — see the loop doc)

Reserve model reasoning for the **irreducible judgment core**: ranking _among_ equally
ready issues, writing acceptance criteria, reviewing PR substance, and deciding to merge.
`gh-queue.mjs` is configurable per repo via `PLEF_*` env vars (label names, priority order,
staleness window) — see its header. **Arbitrary `gh api` is intentionally _not_ wrapped and
stays human-gated.**

## Cheapest-effective-tier

Push contained implementation to a cheaper model tier; reserve premium models for
spec-normative or edge-case-heavy work and for review/merge decisions. The
`fleet-implementer` agent defaults to a mid tier; escalate per issue. See the loop doc.

## Routing

| You are… | Read | Or run |
|---|---|---|
| running the loop | `resources/orchestrator-loop.md` | `/eng-loop` · `eng-orchestrator` agent |
| picking up an issue | `resources/fleet-conventions.md` | `/queue` then claim · `fleet-implementer` agent |
| filing work for the fleet | `resources/issue-authoring.md` | `/file-issue` |

The conventions every fleet member must honor (claim hygiene, acceptance-criteria-as-
contract, `Refs #N` not `Closes #N`, agents stop at PR-open, never touch release/Version
PRs) live in `resources/fleet-conventions.md` and the bundled `rules/`. Read them before
acting in a repo that uses this pattern.
