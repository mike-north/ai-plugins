---
name: eng-loop
description: Run one iteration of the product-led engineering fleet orchestrator loop
---

Run one iteration of the engineering fleet loop as the orchestrator.

Use the `product-led-eng-fleet` skill and follow
`resources/orchestrator-loop.md`. Drive it through the deterministic engine — do not
re-pull and diff issues in context:

1. `git fetch origin <default-branch>` and read the repo's fleet-conventions doc from the remote.
2. `gh-queue status` and `gh-queue list` to see the ranked ready queue (tools in
   the `github-fleet-tools` plugin).
3. For each issue you choose to run: verify it reproduces, `gh-queue ground-truth <N>`,
   then claim with `gh-label <N> add "in progress"` + `gh issue comment <N> "<intent>"`,
   then dispatch a `fleet-implementer` agent with a self-contained brief.
4. Monitor each resulting PR by number; on CI/review feedback dispatch a fix agent that
   replies to every thread; merge with `gh-merge <PR>` (it prompts + guards) and close the
   issue with `gh issue close` when green and resolved.

Do not manufacture work if the queue is saturated by in-flight PRs. Never touch
release/Version PRs. Report what you claimed, delegated, and merged this iteration.
