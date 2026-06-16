# GitHub Fleet Tools

An opinionated, **allowlistable** command-line tool surface for letting an agent engage with
GitHub safely and autonomously. Each tool wraps exactly one `gh` operation with **no
arbitrary-`gh api` escape hatch** — so you can pre-approve exactly those operations and let an
agent loop run without permission stalls, while raw `gh api` stays human-gated.

This is the *tooling* layer; the *methodology* that drives these into a PM/orchestrator loop is
the **product-led-eng-fleet** plugin, which depends on this one.

## Tools

**Read-only**
- `pr-status.sh [PR]` — CI rollup, merge state, and unresolved review threads (with first-comment ids).
- `gh-queue.mjs <list|ground-truth N|status>` — ranked issue work queue + "safe to claim?" check.
- `pr-thread-status.sh <PR> [COMMENT_ID…]` — per-thread resolved/reply status (exit 2 = needs action).
- `pr-review-comment-count.sh [PR] [author]` — inline review-comment + resolved/unresolved counts.

**Bounded writes (one verb each)**
- `issue-label.sh` · `issue-comment.sh` · `issue-close.sh` · `issue-create.sh`
- `pr-comment.sh` · `pr-ready.sh` · `pr-create.sh`
- `pr-reply-resolve.sh` · `pr-resolve-threads.sh`

**Guarded write**
- `pr-merge.sh <N> [--dry-run]` — squash-only; **prompts** (configured as `ask`) and refuses
  unless the PR is open, non-draft, not a release/Version PR, has a reviewer review present, and
  has passed required checks.

## Setup

Scripts are in `skills/github-fleet-tools/scripts/`. Call them by path
(`${CLAUDE_PLUGIN_ROOT}/skills/github-fleet-tools/scripts/<name>`) or — recommended —
symlink them onto your `PATH` (e.g. `~/bin`) and call them by name, which gives stable allowlist
entries independent of the install path:

```bash
ln -sf "$PLUGIN/skills/github-fleet-tools/scripts/"* ~/bin/    # then `gh-queue.mjs list`, `pr-merge.sh 10`, …
```

Allowlist the read tools + bounded writes; leave `pr-merge.sh` as `ask`; keep `gh api` gated.
See `skills/github-fleet-tools/SKILL.md` for the exact rules. All scripts honor `GH` / `GH_HOST`
and require `git` + an authenticated `gh`.

## License

ISC
