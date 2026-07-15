# toolsmith

Guides an agent to **forge narrow, single-purpose, user-approvable scripts**
instead of hand-assembling broad escape-hatch commands (`gh api`, `gh graphql`,
raw `curl`/`wget`, `aws`, `gcloud`, `kubectl`, `op read`). Granting an agent one
of those broadly is uncomfortable; granting it a tiny script that does exactly
one bounded thing is easy — the user proofreads it once and allowlists it
forever. The script *is* the safe, narrow slice of the dangerous command.

This is the general-purpose companion to `github-fleet-tools` (which ships
pre-built GitHub tools): toolsmith is the machinery for building your own,
per project or globally for yourself, as the need arises.

## Two scopes

- **Project scope** — repo-specific, committed to git, reviewed in PRs. Script
  at `<repo>/scripts/agent-tools/<name>`, registry at
  `<repo>/.claude/toolsmith/registry.json`, grant in
  `<repo>/.claude/settings.json`.
- **User/global scope** — personal, reused across every project, **not**
  committed. Script at `~/.claude/toolsmith/tools/<name>`, registry at
  `~/.claude/toolsmith/registry.json`, grant in `~/.claude/settings.json`,
  approved via `--user`, invoked by its fully-expanded absolute path. A
  project tool shadows a same-named user tool.

## What it ships

- **A skill** (`toolsmith`) — when a script is worth building, how to author it
  narrowly (one operation, no arbitrary-API escape hatch, scope baked in),
  choosing project vs. user scope, the registry/approval lifecycle, and
  discovering tools already approved here.
- **A PreToolUse hook** — on a watched Bash command it **redirects** to an
  already-approved tool (project or user scope) when one `covers` the command,
  and **hard-blocks** any registered tool that is unapproved or whose contents
  changed since approval (sha256-pinned). Watched-but-uncovered commands pass
  through untouched.
- **A PostToolUse hook** — logs Bash usage to a bounded, gitignored
  `history.jsonl` (project-scoped) so usage can be mined for tools worth
  building.
- **Commands** — `/toolsmith:analyze` (mine history → propose tool candidates),
  `/toolsmith:approve <path>` (proofread-then-allowlist handshake for either
  scope), and `/toolsmith:list` (registry status + hash-drift check, both
  scopes). Both `approve` and `list` delegate their privileged, mechanical
  steps — hashing, pinning the registry entry, and granting the permission
  rule — to the deterministic `scripts/toolsmith-approve.mjs` tool rather than
  doing them freehand.

## Files it uses

Under `<project>/.claude/toolsmith/` (see
`skills/toolsmith/references/registry-schema.md`):

- `registry.json` — the project's tools and their approval state (commit to
  git).
- `config.json` — optional watchlist overrides (`add`/`remove` patterns).
- `history.jsonl` — the Bash log (generated, gitignored automatically).

Purpose-built project scripts live at `scripts/agent-tools/<name>` and are
approved via `/toolsmith:approve`, which runs the bare
`scripts/toolsmith-approve.mjs <path>` command (add `--dry-run` to preview
first) to pin their sha256 and add `Bash(<path>:*)` to `.claude/settings.json`.

Under `~/.claude/toolsmith/` (same registry schema):

- `registry.json` — the user's global tools and their approval state (not
  committed).
- `tools/<name>` — the global scripts themselves.

Global scripts are approved via `/toolsmith:approve <name>` (which runs
`scripts/toolsmith-approve.mjs --user`, or `--user --dry-run` to preview) to
pin their sha256 and add `Bash(<absolute-path>:*)` to `~/.claude/settings.json`.

## Escape hatch & posture

Set `CLAUDE_TOOLSMITH_HOOK=off` to disable both hooks. The hooks **fail open**
on any internal error — the permission system, not this plugin, is the security
boundary; this is a guidance and redirection layer.

## Development

Run the hook regression tests:

```bash
bash scripts/test.sh
```

## License

ISC
