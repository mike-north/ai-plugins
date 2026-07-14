# toolsmith

Guides an agent to **forge narrow, single-purpose, user-approvable scripts**
instead of hand-assembling broad escape-hatch commands (`gh api`, `gh graphql`,
raw `curl`/`wget`, `aws`, `gcloud`, `kubectl`, `op read`). Granting an agent one
of those broadly is uncomfortable; granting it a tiny script that does exactly
one bounded thing is easy — the user proofreads it once and allowlists it
forever. The script *is* the safe, narrow slice of the dangerous command.

This is the general-purpose companion to `github-fleet-tools` (which ships
pre-built GitHub tools): toolsmith is the machinery for building your own,
per project, as the need arises.

## What it ships

- **A skill** (`toolsmith`) — when a script is worth building, how to author it
  narrowly (one operation, no arbitrary-API escape hatch, scope baked in), the
  registry/approval lifecycle, and discovering tools already approved here.
- **A PreToolUse hook** — on a watched Bash command it **redirects** to an
  already-approved tool when one `covers` the command, and **hard-blocks** any
  registered tool that is unapproved or whose contents changed since approval
  (sha256-pinned). Watched-but-uncovered commands pass through untouched.
- **A PostToolUse hook** — logs Bash usage to a bounded, gitignored
  `history.jsonl` so usage can be mined for tools worth building.
- **Commands** — `/toolsmith:analyze` (mine history → propose tool candidates),
  `/toolsmith:approve <path>` (proofread-then-allowlist handshake), and
  `/toolsmith:list` (registry status + hash-drift check).

## Per-project files it uses

Under `<project>/.claude/toolsmith/` (see
`skills/toolsmith/references/registry-schema.md`):

- `registry.json` — the tools and their approval state (commit to git).
- `config.json` — optional watchlist overrides (`add`/`remove` patterns).
- `history.jsonl` — the Bash log (generated, gitignored automatically).

Purpose-built scripts live at `scripts/agent-tools/<name>` and are approved via
`/toolsmith:approve`, which pins their sha256 and adds `Bash(<path>:*)` to
`.claude/settings.json`.

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
