# Graduation

Graduation is the first-class operation that moves an existing customization up the
[scope ladder](./scope-ladder.md), genericizing it so it survives the trip. It is the answer to the
lifecycle the router could not previously express: *"I built this for myself; now I want it bundled /
synced / shared."*

## Invocation

Two entry points, one flow:

- **Explicit verb** — `/customizations graduate <slug> [--to <rung|marketplace-name>]`. Without
  `--to`, the router recommends the lowest rung that satisfies the detected signals and confirms.
- **Router detection** — graduation intent in prose ("I want to share this with my team", "I need
  this on my laptop too") routes to the same flow, resolving the slug from the manifest by
  description match and confirming the match before acting.

Graduation never runs implicitly. The third entry point — Dream proposals — produces a `proposed`
manifest entry, not an action (below).

## Transitions

**1 → 2 (loose files → skills-dir plugin).** Create `~/.claude/skills/<name>/` with a plugin
manifest (via `claude plugin init` when available, else by hand per plugin-dev `plugin-structure`);
move the entry's `components[]` into it; repoint any cross-references; update the manifest entry
(same slug, new rung, repointed components). Project-scope customizations graduating to rung 2
change owner from repo to user — the flow must call this out (the repo loses the artifact; if
teammates relied on it in-repo, recommend rung 4 instead).

**2 → 3/4 (plugin → marketplace).** `aipm scaffold <name>` into the target marketplace's path (this
also registers the plugin in all four marketplace registry files); move + rewrite artifacts into the
scaffolded layout (`hooks/claude.yaml` for hooks, `skills/`, `commands/`, per-target builds via
`aipm build`); commit. When the target's provenance says `contribute: pr`, all changes land on a
branch and the flow ends with a PR, never a direct push. Rung-1 customizations may take this
transition directly (1 → 3); the rung-2 stop is not mandatory.

**Lateral moves** (project ↔ user at rung 1) reuse the same machinery and are in scope, but carry no
genericization requirement beyond path correctness.

## The genericization engine

The work that makes graduation more than `mv`. On every upward transition the engine:

1. **Scans** every component for portability hazards: literal usernames, `$HOME`-anchored and other
   absolute paths, machine names, repo-layout assumptions, hardcoded tokens/URLs pointing at personal
   infrastructure, harness-specific paths outside the declared target set.
2. **Classifies** each finding: mechanical rewrite (path → `${CLAUDE_PLUGIN_ROOT}`-relative or
   runtime-resolved), config lift (value differs per user/machine → move to a config file with a
   shipped default), or judgment flag (assumption the engine cannot safely rewrite — surfaced, never
   guessed).
3. **Lifts** config-class findings into the established patterns — plugin-settings
   `.claude/<plugin>.local.md` for per-project values, the toolsmith-style
   defaults + `config.json` overlay for tunable behavior — with the previous hardcoded value as the
   user's own config so behavior does not change for them.
4. **Presents a review diff of every change before anything moves.** The engine never auto-applies.
   Approval applies the whole transition atomically; rejection leaves the original untouched.

Acceptance for the engine is mechanical where possible: post-graduation artifacts contain no literal
username or home path (checkable by grep), and the graduated plugin builds clean under `aipm build`
(the CI freshness gate).

## Dream-proposed graduation

The dream/consolidation layer already owns the `proposed → active` manifest seam. It gains
graduation proposals: entries observing e.g. "these three customizations always travel together —
candidate rung-2 bundle" or "this skill appears in transcripts on two machines — candidate rung 3."
A proposal is a `proposed` manifest entry carrying the candidate slug(s) and target rung; the user
reviews via `/customizations list`, and approval hands it to the graduation flow. The standing rule
is unchanged: **never author or act on `proposed` entries without explicit approval.**

## Monitors as cargo

Monitors are versioned, shareable `MONITOR.md` files (see the Open Monitor Standard at
agentmonitors.io) and graduate like any other component. Two specifics:

- The authoring reference must be refreshed against the live standard before this ships: five
  bundled source types (`file-fingerprint`, `api-poll`, `command-poll`, `schedule`,
  `incoming-changes`), Claude Code / Codex / Cursor support — superseding the stale "Claude-only,
  no push sources" text. The read-fresh convention stands: fetch the live docs when authoring,
  never rely on memorized schemas.
- Genericization has monitor-specific hazard classes: `file-fingerprint` globs anchored to personal
  paths, `api-poll` URLs/auth pointing at personal infrastructure, `command-poll` argv referencing
  machine-local binaries. Each is a config lift, not a mechanical rewrite.

## Non-goals

- Graduation does not publish to any registry beyond the target marketplace's own files, and never
  changes repo visibility or secrets (fleet hard rules apply).
- No downward transitions ("de-graduation") in this iteration — removing a plugin and re-creating
  loose files is manual.
- No cross-user adoption flow ("import my teammate's customization") — consumption is the host's
  marketplace install, tracked by provenance as today.
