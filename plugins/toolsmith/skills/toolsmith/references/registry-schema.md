# toolsmith registry & config schema

Both files live under `<project>/.claude/toolsmith/` and are **read by the
PreToolUse hook** on every candidate Bash command. The registry is the source
of truth for which purpose-built tools exist and which are approved; commit it
to git so approvals are reviewable in PRs.

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
| `path` | Project-relative path to the executable script (e.g. `scripts/agent-tools/<name>`). |
| `purpose` | One sentence: what the tool does. Shown to the agent in redirect messages. |
| `args` | Human-readable argument summary (e.g. `<pr-number>`), shown in the suggested call. |
| `scope` | What the tool is bounded to (repo/org/read-only). Documentation for the reviewer. |
| `covers` | Array of JavaScript RegExp strings tested against the raw Bash command. If a **watched** command matches any of an **approved** tool's `covers`, the hook denies it and points here. |
| `status` | `draft` (registered, not yet approved) or `approved`. Only `approved` tools redirect; invoking a `draft`/unapproved tool is denied. |
| `approvedSha256` | sha256 of the script contents, computed and pinned by `scripts/toolsmith-approve.mjs --commit` at approval. The hook denies execution if the on-disk file no longer matches. |
| `permissionRule` | The exact allowlist rule `scripts/toolsmith-approve.mjs --commit` adds to `.claude/settings.json` (via `/toolsmith:approve`), e.g. `Bash(<path>:*)`. |

`name`, `path`, `purpose`, `args`, `scope`, and `covers` must be authored by
hand as a `draft` entry before running `/toolsmith:approve` — the
deterministic tool only ever pins `status`, `approvedSha256`, and
`permissionRule`; it refuses to run against a path with no existing registry
entry rather than inventing the rest.

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
`config.json` as absent (fail-open), so a JSON syntax error silently disarms
the redirect and tamper block. `/toolsmith:list` surfaces this — if the
registry won't parse it reports a parse error rather than "no tools
registered", so fix the JSON to re-arm the hook.
