---
name: publish-pr
description: >
  Post a completed code review's merged SARIF findings to a GitHub pull request as a PENDING
  review. Use after the `review` skill has produced a `merged.sarif.json` for a PR and you're
  ready to publish it — this skill does the posting, `review` never does.
user-invocable: true
---

# Publish PR Review

Takes a `merged.sarif.json` from a prior `review` skill run's work area, plus the PR it was
reviewed against, and posts it as one **PENDING** GitHub review — inline comments where a
finding has a line, a general comment for `scope: "pr"` findings. A human submits (approve /
request changes / comment) the pending review; this skill never submits on your behalf.

Let `$SKILL` be this file's directory (`${CLAUDE_PLUGIN_ROOT}/skills/publish-pr` in Claude Code).

## Usage

```bash
node "$SKILL/../review/scripts/post-review.mjs" --sarif <work-area>/merged.sarif.json \
  [--pr-url <url> | --repo <owner/repo> --pr <N>] [--host <h>] \
  [--work-area <dir>] [--dry-run]
```

Run with `--dry-run` first and show the user what would be posted before posting for real.
`--pr-url` works for both dotcom and GitHub Enterprise — the host is parsed from the URL itself
and passed to `gh` as `--hostname`; use `--repo`/`--pr` (+ optional `--host`) instead if you don't
have a URL. Pass `--work-area <dir>` so a fix's suggestion fence can be reconstructed against the
review's own worktree.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | posted (or, with `--dry-run`, would post) cleanly |
| 3 | (dry-run only) a finding couldn't be anchored on the PR's current diff |
| 4 | the PR's head moved since this review was based — no mutation is made; re-run `review` against the new head, don't post stale findings |
| 5 | partial post — some comments landed, some didn't; a JSON report of what succeeded/failed is printed so you can retry just the failures, not the whole review |
| 6 | a PENDING review from another source already exists on this PR — it is never deleted or touched; surface this to the human and ask how they want to proceed |

After a clean post, run `node "$SKILL/../review/scripts/review-cleanup.mjs" --work-area
<dir>` to release the work area's snapshot refs and lock (it leaves `state.json`/`findings/` for
inspection, and never touches the worktree itself).
