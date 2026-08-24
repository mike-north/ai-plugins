# toolsmith registry & config schema

There are two independent registries, same schema, read by the same
**PreToolUse hook** on every candidate Bash command (see the shared-contract
table below):

- **Project registry** — `<project>/.claude/toolsmith/registry.json`. Commit
  it to git so approvals are reviewable in PRs.
- **User (global) registry** — `~/.claude/toolsmith/registry.json`. Personal,
  reused across every project, **not** committed.

The hook builds an *effective* tool set from both: all project tools, plus
any user tool whose `name` isn't already defined by a project tool — a
project tool **shadows** a same-named user tool.

## The staged/live split

Every tool's on-disk bytes exist in one of three states — see
[`docs/toolsmith/staged-live-split.md`](../../../../docs/toolsmith/staged-live-split.md)
for the full design (write-denial mechanism and its honest limits, the
promotion apply manifest, rollout):

- **Staged** — an agent-authored draft (new tool, or a proposed revision of
  an existing one) under the staging namespace below. Never executable, never
  registered with steering. The hook never reads it.
- **Live** — the registered `path`, unchanged from today. Owner-writable only
  through `/toolsmith:approve`'s promotion; otherwise `0555` (r-x, no write)
  and (on macOS/BSD) the `uchg` immutable flag.
- **Retired** — removed from live; the registry entry's `status` becomes
  `retired`.

**An edit to a live tool never touches live.** The agent always authors into
staging; `/toolsmith:approve <path>` is the only path that moves bytes from
staging to live (the promotion apply manifest: place → mode+flag → recompute
+ pin the hash from the placed bytes → grant the rule → clear `staged` →
remove the staging file). The last-approved live version keeps running the
whole time a revision is pending, so there is no re-sign lockout.

### Staging namespace

- **Project scope**: `<projectRoot>/.claude/toolsmith/staging/<name>`.
- **User scope**: `<home>/.claude/toolsmith/staging/<name>`.

A project entry's `staged.path` is project-root-relative and **must** resolve
strictly under `.claude/toolsmith/staging/` — validated with the same strict
`normalizePath` rules used for the live `path` field, plus a check that its
first three segments are exactly `.claude`, `toolsmith`, `staging`. A user
entry's `staged.path` is relative to `<home>/.claude/toolsmith/` (e.g.
`staging/<name>`) and validated the same way the live `tools/<name>` path is,
with `staging` required as the first segment instead of `tools`.

## `registry.json`

```json
{
  "version": 1,
  "tools": [
    {
      "name": "gh-pr-reactions",
      "path": "scripts/agent-tools/gh-pr-reactions",
      "purpose": "Read emoji reactions on review comments for a PR in this repo",
      "args": "<pr-number>",
      "scope": "repo:mike-north/ai-plugins (read-only)",
      "covers": [
        "gh\\s+api\\b.*/pulls/\\d+/comments",
        "gh\\s+api\\b.*/reactions"
      ],
      "status": "approved",
      "approvedSha256": "9f2b…（64 hex chars）",
      "permissionRule": "Bash(scripts/agent-tools/gh-pr-reactions:*)",
      "staged": {
        "path": ".claude/toolsmith/staging/gh-pr-reactions",
        "sha256": "advisory — recomputed at promotion, never trusted",
        "note": "adds a --json flag",
        "since": "2026-07-19T18:00:00Z"
      }
    }
  ]
}
```

A brand-new tool (never yet live) is `status: draft` with only `staged`
populated — no `approvedSha256`/`permissionRule` active yet. `staged` is
**optional**: its absence means there is no pending draft for that entry
(today's semantics, unchanged).

Field reference:

| Field | Meaning |
|---|---|
| `name` | Stable bare command name, also the basename of `path`. Used to detect invocation and in messages. |
| `path` | Location of the **live** executable script, relative to the registry's own scope (see the shared-contract table below). Unchanged by promotion — the live location is fixed at registration time. |
| `purpose` | One sentence: what the tool does. Shown to the agent in redirect messages. |
| `args` | Human-readable argument summary (e.g. `<pr-number>`), shown in the suggested call. |
| `scope` | What the tool is bounded to (repo/org/read-only). Documentation for the reviewer. |
| `covers` | Array of JavaScript RegExp strings tested against the raw Bash command. If a **watched** command matches any of an **approved** tool's `covers`, the hook denies it and points here. |
| `status` | `draft` (registered, not yet approved), `approved`, or `retired` (removed from live; see the design doc's Rollout/Demotion notes). Only `approved` tools redirect; invoking a `draft`/`retired`/unapproved tool is denied. |
| `approvedSha256` | sha256 of the **live** script's bytes, recomputed from the bytes actually placed at promotion time (never trusted from `staged.sha256`) and pinned by `/toolsmith:approve`. The hook denies execution if the on-disk live file no longer matches. |
| `permissionRule` | The exact allowlist rule added to the scope's `settings.json` at promotion — see the shared-contract table for the exact form per scope. |
| `staged` (optional) | Present iff a draft is pending promotion. `path` — the staging draft's location (see "Staging namespace" above). `sha256` — advisory only, shown by `/toolsmith:list`; promotion always recomputes from the placed bytes. `note` — one-line agent-authored summary of the change. `since` — ISO 8601 timestamp the draft was authored/updated. |

`name`, `path`, `purpose`, `args`, `scope`, and `covers` must be authored by
hand as a `draft` entry before running `/toolsmith:approve`; `staged` is
authored by hand too (the agent writes the draft file into staging and points
`staged.path` at it). The deterministic promotion tool only ever pins
`status`, `approvedSha256`, and `permissionRule`, and clears `staged` — it
refuses to run against a path with no existing registry entry, or against an
entry with no `staged` draft to promote, rather than inventing the rest.

**Author `covers` for wrapper binaries too.** A `covers` pattern is tested
against the raw command string, same as a `watchlist` pattern — it does not
automatically account for wrapper/alias binaries that shell out to the real
command (e.g. `gh_dotcom`, a common wrapper that pins `gh` to github.com). If
the watchlist matches a wrapper form but a tool's `covers` pattern only
matches the bare command name, a watched-and-otherwise-covered command
silently falls through as "uncovered" when invoked via the wrapper. Follow the
shipped defaults' convention — the regex `gh(_\w+)?\s+api\b` rather than
`gh\s+api\b` — for any command family with known wrapper binaries. Note that
`covers` values live in JSON, where every regex backslash must be doubled:
the entry is written `"gh(_\\w+)?\\s+api\\b"`.

## Project vs. user scope — the shared contract

Both the PreToolUse hook and `toolsmith-approve.mjs` agree on this table:

| Concern | Project scope | User scope |
|---|---|---|
| Registry file | `<projectRoot>/.claude/toolsmith/registry.json` | `<home>/.claude/toolsmith/registry.json` |
| Entry `path` field | project-relative, e.g. `scripts/agent-tools/gh-x` | home-subdir-relative, e.g. `tools/gh-x` (relative to `<home>/.claude/toolsmith/`) |
| Script file resolves to | `<projectRoot>/<path>` | `<home>/.claude/toolsmith/<path>` (i.e. `<home>/.claude/toolsmith/tools/gh-x`) |
| Settings file for the grant | `<projectRoot>/.claude/settings.json` | `<home>/.claude/settings.json` |
| `permissionRule` | `Bash(<path>:*)` (relative) | `Bash(<ABS>:*)` where `<ABS>` is the fully-expanded absolute script path |
| sha256 | of the script file bytes | of the script file bytes (unchanged) |

`<home>` is `os.homedir()`. A user-scope entry's `path` **must** be under
`tools/` — it is validated with the same strict `normalizePath` used for
project paths (no `..`, no absolute, safe characters only), plus a check that
its first path segment is exactly `tools`, so it can only resolve inside
`<home>/.claude/toolsmith/tools/`. A user tool is invoked by its
fully-expanded absolute path (what `/toolsmith:approve` prints) so the
`Bash(<ABS>:*)` rule matches deterministically.

## `config.json` (optional, layered like the registry)

Overrides the shipped default watchlist. Like the registry, `config.json`
exists at both scopes and is merged **broad → specific**:

```
shipped defaults  ->  user config (~/.claude/toolsmith/config.json)  ->  project config (<projectRoot>/.claude/toolsmith/config.json)
```

At each layer, `watchlist.add` unions in new patterns and `watchlist.remove`
subtracts a pattern already present at that point in the merge — a shipped
default, or an `add` from a broader layer already applied. This means:

- A pattern in the **user** config's `add` is watched in every project,
  including one with no `config.json` of its own at all.
- A **project** `remove` can drop a pattern the **user** config just added
  (project wins on conflict), and a project `add` still applies even when the
  user layer added nothing.
- A **user** `remove` can drop a shipped default globally, for every project
  (absent a project-level re-add).

`remove` strings must match verbatim against whatever pattern string is
present at that point in the merge — a shipped default (see
`watchlist-defaults.json`), or a pattern a broader layer's `add` introduced.
It is not restricted to shipped defaults only.

```json
{
  "watchlist": {
    "add": ["(^|[|&;( ])terraform\\s+(apply|destroy)\\b"],
    "remove": ["(^|[|&;( ])kubectl\\s+"]
  }
}
```

When the project root resolves to `$HOME` itself, the user and project
`config.json` are the same file; it is applied once, not twice (mirrors the
registry's same-file guard for issue #36).

## Write denial on live: the harness deny-rule layer

Per docs/toolsmith/staged-live-split.md §Write denial, layer 2 (defense in
depth alongside the live file's `0555` + `uchg` mode/flag, layer 1, and the
hook's integrity-pin backstop, layer 3): this layer now **ships as a plugin
hook** — `scripts/toolsmith-write-check.mjs`, wired via
`scripts/toolsmith-write-gate.sh` on `PreToolUse` for
`Write`/`Edit`/`NotebookEdit` (see `hooks/claude.yaml` and its per-host
mirrors). It denies any of those tools when the resolved target path falls
under a scope's live tool directory:

- project live dir: `<project>/scripts/agent-tools/`
- user live dir: `~/.claude/toolsmith/tools/`

For either scope's settings file (`<project>/.claude/settings.json`,
`~/.claude/settings.json`) the check is **content-targeted, not blanket**: an
edit is denied only when it would *introduce* a `Bash(...)` rule pointing at
a toolsmith live tool path — the self-grant reserved for `/toolsmith:approve`.
All other settings edits (other permissions, hooks, env, plugin config) pass
through untouched, so installing toolsmith never makes the harness's main
configuration files uneditable.

The live-dir rule is unconditional — it fires whether or not the project has
a toolsmith registry at all, unlike the redirect/hash-pin logic in
`toolsmith-check.mjs`. Staging directories (`.claude/toolsmith/staging/` and
`~/.claude/toolsmith/staging/`) are deliberately never checked — the agent is
expected to write there constantly; that write activity is exactly what the
split is for. The settings guard does not break the promotion handshake
either: `toolsmith-approve.mjs` writes settings via `node:fs`, not the
Write/Edit tools, so it is unaffected by this hook.

Keeping `Bash(chflags:*)`/`Bash(chmod:*)` **out** of the allowlist for live
paths (so flag-stripping falls to a manual ask) remains a recommendation this
plugin does not enforce — that is host-config the plugin doesn't own. As
**optional defense in depth**, a project may additionally add its own
`permissions.deny` rules (Claude Code shape shown, adapt per host):

```json
{
  "permissions": {
    "deny": [
      "Edit(scripts/agent-tools/**)",
      "Write(scripts/agent-tools/**)",
      "NotebookEdit(scripts/agent-tools/**)",
      "Edit(~/.claude/toolsmith/tools/**)",
      "Write(~/.claude/toolsmith/tools/**)",
      "NotebookEdit(~/.claude/toolsmith/tools/**)"
    ]
  }
}
```

Adjust the project-scope glob to match wherever `scripts/agent-tools/` (or
this repo's chosen live directory) actually lives.

**Honest limit:** the hook only runs where this plugin's hooks are wired for
a given host and tool. Where it can't fire (an unsupported host, or a tool
outside Write/Edit/NotebookEdit), layer 1 (mode + `uchg`) and layer 3 (the
hook's integrity pin) still hold — this layer only makes the *common*
accidental edit fail earlier and more politely (a clear denial from the
agent's own tool, before ever reaching the filesystem).

## `history.jsonl` (generated, gitignored)

One JSON object per Bash call appended by the PostToolUse logger:
`{ "ts", "cwd", "command", "exitCode" }`. Bounded to ~2000 lines. Mined by
`/toolsmith:analyze`. The logger writes a `.gitignore` next to it so it is
never committed.

**Note:** the log stores full command strings verbatim, which can include
inline secrets (e.g. `curl -H "Authorization: Bearer …"`, `op read …`). It is
local and gitignored, but plaintext — treat `.claude/toolsmith/` as sensitive
and don't copy the log elsewhere. Recurring secret-bearing commands are exactly
the kind of thing to replace with a narrow, reviewed script.

## Malformed files

Both the hook and `/toolsmith:list` treat an unparseable `registry.json` or
`config.json` — in either scope — as absent (fail-open), so a JSON syntax
error silently disarms the redirect and tamper block for that scope only (the
other scope is unaffected). `/toolsmith:list` surfaces this per scope — if a
registry won't parse it reports a parse error rather than "no tools
registered" for that scope, so fix the JSON to re-arm the hook.
