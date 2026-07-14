---
name: toolsmith
description: >-
  Use when about to run — or repeatedly running — a broad, hard-to-allowlist escape-hatch
  command (gh api, gh graphql, raw curl/wget to an API, aws/gcloud/kubectl, op read) to
  do something narrow. Instead of hand-assembling a one-off command that forces a manual
  permission prompt, forge a small single-purpose script the user proofreads once and
  allowlists forever. Covers when a script is worth building, how to author it narrowly,
  the registry/approval lifecycle, and discovering tools already approved for this project.
  Triggers on gh api pipelines, "just this once" broad commands, recurring jq-over-API
  wrangling, and permission-prompt fatigue.
---

# toolsmith

Broad commands like `gh api`, raw `curl`, `aws`, or `kubectl` are painful to
allowlist: granting them wholesale hands the agent far more power than any one
task needs, so they stay gated and every use costs a manual approval. The
answer is not to widen the allowlist — it is to **forge a narrow tool**. A
small, single-purpose script that does exactly one bounded thing is something
the user can read once, approve, and never be asked about again. The script
*is* the safe, narrow slice of the dangerous command.

## Before running a watched command

1. **Check what already exists.** Read `.claude/toolsmith/registry.json`. If an
   approved tool covers what you need, use it — that is why it exists. (The
   PreToolUse hook will block a watched command and name the tool if one covers
   it, but reach for the tool first rather than getting redirected.)
2. **If nothing covers it, decide whether to build one.** Apply the rubric in
   `references/authoring-checklist.md`: build only if the operation is
   Compound, Missing, Guarded, or Permission-scopable. A genuinely one-off
   read you will never repeat can just be run (ask the user); recurring or
   pipeline-heavy broad usage is the signal to forge a tool.

## Forging a tool

Follow `references/authoring-checklist.md`. In short: one operation, no
arbitrary-API escape hatch, scope baked in (hardcode the repo/org/method),
validate narrow arguments, stable bare name, `--help`, fail closed. Put it at
`scripts/agent-tools/<name>` and add a `draft` entry to the registry
(`references/registry-schema.md`).

## Approval lifecycle

`draft` → user proofreads the exact contents → `/toolsmith:approve <path>` →
the sha256 is pinned, `status` flips to `approved`, and `Bash(<path>:*)` is
added to `.claude/settings.json`. From then on the tool runs without a prompt.
Any edit changes the hash, so the hook blocks the tool until you re-run
`/toolsmith:approve`. **Never** add the permission rule yourself or ask the
user to widen the allowlist — the approve command is the only sanctioned path,
because it couples the allowlist grant to a specific reviewed script version.

## Discovering what to build

The PostToolUse hook logs Bash usage to `.claude/toolsmith/history.jsonl`. Run
`/toolsmith:analyze` to mine it: it clusters repeated or pipeline-heavy watched
commands and proposes concrete tool candidates (name, purpose, `covers`
patterns, a script sketch) against the rubric. It *proposes* — it never creates
or approves anything silently. `/toolsmith:list` shows the current registry and
flags any approved tool whose file drifted from its pinned hash.

## How the hooks behave (so redirects aren't surprising)

- **PreToolUse** denies a watched command only when an **approved** tool's
  `covers` pattern matches it; watched-but-uncovered commands pass through to
  the normal permission flow. It also denies running any registered tool that
  is unapproved or whose contents changed since approval.
- **PostToolUse** appends a compact log line per Bash call (gitignored, bounded).
- Both honor `CLAUDE_TOOLSMITH_HOOK=off` as a full escape hatch, and fail open
  on any internal error — the permission system, not this plugin, is the
  security boundary.

## References

- `references/authoring-checklist.md` — the rubric and the script authoring standard.
- `references/registry-schema.md` — `registry.json`, `config.json`, `history.jsonl` schemas.
- `references/watchlist-defaults.json` — shipped watched-command patterns and rationale.
