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
      "permissionRule": "Bash(scripts/agent-tools/gh-pr-reactions:*)"
    }
  ]
}
```

Field reference:

| Field | Meaning |
|---|---|
| `name` | Stable bare command name, also the basename of `path`. Used to detect invocation and in messages. |
| `path` | Location of the executable script, relative to the registry's own scope (see the shared-contract table below). |
| `purpose` | One sentence: what the tool does. Shown to the agent in redirect messages. |
| `args` | Human-readable argument summary (e.g. `<pr-number>`), shown in the suggested call. |
| `scope` | What the tool is bounded to (repo/org/read-only). Documentation for the reviewer. |
| `covers` | Array of JavaScript RegExp strings tested against the raw Bash command. If a **watched** command matches any of an **approved** tool's `covers`, the hook denies it and points here. |
| `status` | `draft` (registered, not yet approved) or `approved`. Only `approved` tools redirect; invoking a `draft`/unapproved tool is denied. |
| `approvedSha256` | sha256 of the script contents, computed and pinned by the bare `scripts/toolsmith-approve.mjs` command (or `--user` for a global tool) at approval. The hook denies execution if the on-disk file no longer matches. |
| `permissionRule` | The exact allowlist rule added to the scope's `settings.json` at approval (via `/toolsmith:approve`) — see the shared-contract table for the exact form per scope. |

`name`, `path`, `purpose`, `args`, `scope`, and `covers` must be authored by
hand as a `draft` entry before running `/toolsmith:approve` — the
deterministic tool only ever pins `status`, `approvedSha256`, and
`permissionRule`; it refuses to run against a path with no existing registry
entry rather than inventing the rest.

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

## `config.json` (optional)

Overrides the shipped default watchlist. `remove` strings must match a default
`pattern` verbatim (see `watchlist-defaults.json`).

```json
{
  "watchlist": {
    "add": ["(^|[|&;( ])terraform\\s+(apply|destroy)\\b"],
    "remove": ["(^|[|&;( ])kubectl\\s+"]
  }
}
```

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
