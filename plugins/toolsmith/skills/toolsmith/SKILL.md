---
name: toolsmith
description: >-
  Use when about to run — or repeatedly running — a broad, hard-to-allowlist escape-hatch
  command (gh api, gh graphql, raw curl/wget to an API, aws/gcloud/kubectl, op read) to
  do something narrow. Instead of hand-assembling a one-off command that forces a manual
  permission prompt, dispatch the tool-curator agent to answer with an existing tool, a
  native CLI command, or a small single-purpose script staged for the user to proofread
  once and allowlist forever. Covers when dispatch is warranted, the authoring standard
  the curator (and the no-subagent fallback) follows, the registry/approval lifecycle,
  and discovering tools already approved for this project. Triggers on gh api pipelines,
  "just this once" broad commands, recurring jq-over-API wrangling, and permission-prompt
  fatigue.
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

1. **Check what already exists.** Read `.claude/toolsmith/registry.json`
   (project) and `~/.claude/toolsmith/registry.json` (user/global). If an
   approved tool in either covers what you need, use it — that is why it
   exists. (The PreToolUse hook will block a watched command and name the
   tool if one covers it, but reach for the tool first rather than getting
   redirected.) A project tool shadows a same-named user tool.
2. **If nothing covers it, dispatch the `tool-curator` agent — don't forge
   inline.** Do not apply the rubric, probe native porcelain, or author a
   staging draft yourself; that is the curator's job. Hand it a **capability
   brief** — the capability you need, never a command design or tool sketch —
   and go back to your own work in a clean context window. If you're blocked
   right now on the result, ask the user to approve the raw command once
   while the curator works in the background. The curator answering "use
   this existing CLI command, invoked like so" is a **success outcome**, not
   a failed forge — most capabilities are already one flag away from
   something native.

   Dispatch prompt (~6 lines):

   > Capability/goal: `<what you need to be able to do, in plain terms>`.
   > Raw command you were about to run: `<the exact command>`. Repo/org
   > context: `<repo, org, any scope constraints>`. Expected frequency:
   > `<one-off / recurring — how often you expect to need this>`.
   >
   > Return one of: **use-existing-tool** (name the approved tool and the
   > exact invocation), **no-tool-needed** (the exact native CLI porcelain
   > command to use instead), or **curated** (a staging draft + draft
   > registry entry — extend, refactor, or forge — or a report-only
   > retirement proposal). You never promote to live; `/toolsmith:approve`
   > stays a human step.

   If your harness cannot dispatch agents (e.g. Codex), perform the
   curator's procedure yourself, in its order: native porcelain first, then
   both registries, then the rubric, then a staging draft.

## Choosing project vs. user (global) scope

Two scopes coexist:

| | Project scope | User/global scope |
|---|---|---|
| Script location | `<project>/scripts/agent-tools/<name>` | `~/.claude/toolsmith/tools/<name>` |
| Registry | `<project>/.claude/toolsmith/registry.json` | `~/.claude/toolsmith/registry.json` |
| Settings grant | `<project>/.claude/settings.json` | `~/.claude/settings.json` |
| Permission rule | `Bash(<relative-path>:*)` | `Bash(<absolute-path>:*)` |
| Committed to git? | Yes — reviewed in PRs | No — personal, not committed |
| Approve with | `/toolsmith:approve <path>` | `/toolsmith:approve <name>` (uses `--user` under the hood) |

Default to **project scope** when the tool is specific to this repo (bakes in
this repo/org, only useful here) — it's reviewable in PRs and travels with the
codebase. Use **user/global scope** when the tool is personal and reused
across many projects (e.g. a `gh`/`aws` helper you'd otherwise recreate in
every repo) — it lives once under `~/.claude/toolsmith/tools/` and is
approved once, for every project you work in.

A user-scope tool is invoked by its **fully-expanded absolute path**
(`~/.claude/toolsmith/tools/<name>`, expanded — no `~` or `$HOME` in the
command), because the granted `Bash(<absolute-path>:*)` rule only matches that
exact string. `/toolsmith:approve` prints the absolute path to use.

## Forging a tool

Forging is normally the `tool-curator` agent's job, reached by dispatching it
as above; this section is the shared reference both the curator and the
no-subagent fallback follow.

Follow `references/authoring-checklist.md`. In short: one operation, no
arbitrary-API escape hatch, scope baked in (hardcode the repo/org/method),
validate narrow arguments, stable bare name, `--help`, fail closed.

**Always write to staging, never to the live path.** Put the draft at
`.claude/toolsmith/staging/<name>` (project) or
`~/.claude/toolsmith/staging/<name>` (user/global) and add a `draft` entry to
the corresponding registry with a `staged` field pointing at it
(`references/registry-schema.md`). Nothing in staging is executable or known
to steering — iterate there freely. The tool's eventual live location
(`scripts/agent-tools/<name>` / `~/.claude/toolsmith/tools/<name>`) is where
`/toolsmith:approve` will place it; you never write there directly.

## The staged/live split and the approval lifecycle

Every tool exists in one of three states — staged (draft, inert, agent-
writable), live (registered, `0555` + immutable-flagged, agent-unwritable),
or retired. See
[`docs/toolsmith/staged-live-split.md`](../../../../docs/toolsmith/staged-live-split.md)
for the full design, including the write-denial mechanism's honest limits.

`draft` (staged) → user proofreads the exact staged contents →
`/toolsmith:approve <path>` → the deterministic `scripts/toolsmith-approve.mjs`
tool **promotes** the staged draft to live as an atomic apply manifest: place
the bytes → set `0555` + the BSD immutable flag (`uchg`, where available) →
recompute the sha256 from the bytes actually placed (never trusted from the
staging draft) → pin it as `approvedSha256` → flip `status` to `approved` →
grant exactly one `Bash(<path>:*)` rule in `.claude/settings.json` → clear the
entry's `staged` field → remove the staging file. For a user/global tool, the
same command runs `toolsmith-approve.mjs --user`, reading/writing
`~/.claude/toolsmith/registry.json` and `~/.claude/settings.json` instead, and
grants `Bash(<absolute-path>:*)`. From then on the tool runs without a prompt.
The agent never freehands the hash computation, the registry pin, or the
permission grant — `/toolsmith:approve` runs the deterministic tool with
`--dry-run` first (no writes), showing a diff against current live for a
revision or the full text for a new tool, so the user reviews exactly what
will be placed before anything is written, then runs the bare command (no
flag) to promote only after explicit confirmation.

**Revising an already-approved tool never touches live.** Author the revision
into the same staging location and repeat the approval handshake — the
previous live version keeps serving every invocation while the revision is
pending, so there is no lockout waiting on re-approval. Any drift between a
live file's bytes and its pinned hash (which should only ever happen via
promotion) blocks the tool until it is re-approved. **Never** add the
permission rule yourself, write directly to a live path, or ask the user to
widen the allowlist — `/toolsmith:approve` is the only sanctioned path into
live, because it couples the allowlist grant to a specific reviewed,
content-addressed script version, in either scope.

## Discovering what to build

The PostToolUse hook logs Bash usage to `.claude/toolsmith/history.jsonl`. Run
`/toolsmith:analyze` to mine it: it clusters repeated or pipeline-heavy watched
commands and proposes concrete tool candidates (name, purpose, `covers`
patterns, a script sketch) against the rubric. It *proposes* — it never creates
or approves anything silently. `/toolsmith:list` shows both the project and
user registries and flags any approved tool whose file drifted from its
pinned hash.

## How the hooks behave (so redirects aren't surprising)

- **PreToolUse** denies a watched command only when an **approved** tool's
  `covers` pattern matches it, whether that tool is project- or user-scoped;
  watched-but-uncovered commands pass through to the normal permission flow.
  It also denies running any registered tool that is unapproved or whose
  contents changed since approval. If a project and a user tool share a
  `name`, the project tool governs.
- **PostToolUse** appends a compact log line per Bash call (gitignored, bounded).
- Both honor `CLAUDE_TOOLSMITH_HOOK=off` as a full escape hatch, and fail open
  on any internal error — the permission system, not this plugin, is the
  security boundary.

## References

- `references/authoring-checklist.md` — the rubric and the script authoring standard.
- `references/registry-schema.md` — `registry.json` (including the staging namespace and `staged` fields), `config.json`, `history.jsonl` schemas, and the recommended harness deny-rule set.
- `references/watchlist-defaults.json` — shipped watched-command patterns and rationale.
- `docs/toolsmith/staged-live-split.md` — the staged/live split design: write-denial mechanism and its honest limits, the promotion apply manifest, rollout.
