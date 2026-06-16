---
name: queue
description: Show the ranked ready queue and fleet status (deterministic, via the engine)
---

Show the current fleet work queue using the deterministic engine — never by reading and
diffing issues in context.

Run (scripts from the `github-fleet-tools` plugin):

```
gh-queue status
gh-queue list
```

Present the ranked ready queue (deadline → priority → number) and the rollup (ready /
in-progress / open PRs). If the caller named an issue number, also run
`gh-queue ground-truth <N>` and report whether it is safe to claim. Do not claim or
modify anything — this command is read-only reporting.
