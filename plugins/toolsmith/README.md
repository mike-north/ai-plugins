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

## Install

Available from this repo's marketplace (`ai-plugins`). Add the marketplace
once, host-native, and install the plugin — or use the universal fallback:

```bash
npx plugins add mike-north/ai-plugins   # installs into Claude Code, Cursor, and Codex
```

See the [repo root README](../../README.md) for the full multi-platform
install story.

## Quick start: one loop, start to finish

1. **An agent reaches for a broad command.** Nothing covers it yet, so the
   PreToolUse hook lets it pass through untouched to the normal permission
   prompt — watched-but-uncovered commands are never blocked, they just cost
   a manual approval like always:

   ```bash
   $ gh api repos/mike-north/ai-plugins/pulls/7/comments | jq '.[] | {user: .user.login, body}'
   ```

2. **The pattern recurs**, so `/toolsmith:analyze` mines the logged history
   and proposes a candidate — name, purpose, `covers` pattern, a script
   sketch — against the authoring rubric.

3. **The agent forges the script** at `scripts/agent-tools/gh-pr-comments`
   and a matching `draft` entry in `.claude/toolsmith/registry.json`.

4. **The user runs `/toolsmith:approve scripts/agent-tools/gh-pr-comments`.**
   It previews first, read-only, via `toolsmith.mjs approve --dry-run`:

   ```
   Tool: gh-pr-comments
   Path: scripts/agent-tools/gh-pr-comments
   Computed sha256: ebac191573528f9afbe83bab2bb5c13ca0102d0089044d5865c7fcdc0af188bb
   Permission rule: Bash(scripts/agent-tools/gh-pr-comments:*)
   Already in settings.json: no

   DRY RUN — nothing written; re-run without --dry-run to apply.
   ```

   Once the user has read the script and confirms, the bare command writes:

   ```
   Pinned scripts/agent-tools/gh-pr-comments: status=approved, approvedSha256=ebac191573528f9afbe83bab2bb5c13ca0102d0089044d5865c7fcdc0af188bb
   permissionRule set to: Bash(scripts/agent-tools/gh-pr-comments:*)
   Added rule to .claude/settings.json permissions.allow.
   chmod +x applied to scripts/agent-tools/gh-pr-comments.
   ```

5. **From then on it runs with no prompt.** And the raw command is now
   *covered*: the PreToolUse hook denies it and redirects to the tool instead:

   ```
   A purpose-built, pre-approved tool already covers this. Run `scripts/agent-tools/gh-pr-comments <pr-number>`
   (the approved `gh-pr-comments` tool) instead of a one-off command — Read review comments on a PR in this
   repo. It exists precisely so this narrow operation is allowlisted while the broad command stays gated.
   If it genuinely does not fit, tell the user why and ask them to run the raw command.
   ```

6. **Any edit trips the sha256 pin.** The next invocation of the edited
   script is denied until it's re-approved:

   ```
   `gh-pr-comments` (scripts/agent-tools/gh-pr-comments) has changed since it was approved (sha256 mismatch),
   so its prior approval no longer applies. Have the user re-review the new contents and run
   `/toolsmith:approve scripts/agent-tools/gh-pr-comments` to re-pin it.
   ```

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
  through untouched. Watchlist and `covers` patterns account for wrapper
  binaries too — e.g. `gh(_\w+)?\s+api\b` also matches `gh_dotcom api`, a
  common wrapper that pins `gh` to github.com, so a redirect can't be
  bypassed by invoking through the wrapper's name instead (note the doubled
  backslashes once this lives in JSON: `"gh(_\\w+)?\\s+api\\b"`). See
  `skills/toolsmith/references/registry-schema.md`.
- **A PostToolUse hook** — logs Bash usage to a bounded, gitignored
  `history.jsonl` (project-scoped) so usage can be mined for tools worth
  building.
- **Commands** — `/toolsmith:analyze` (mine history → propose tool candidates),
  `/toolsmith:approve <path>` (proofread-then-allowlist handshake for either
  scope), and `/toolsmith:list` (registry status + hash-drift check, both
  scopes). Both `approve` and `list` delegate their privileged, mechanical
  steps — hashing, pinning the registry entry, and granting the permission
  rule — to the deterministic `scripts/toolsmith.mjs` CLI (`toolsmith approve`) rather than
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
`scripts/toolsmith.mjs approve <path>` command (add `--dry-run` to preview
first) to pin their sha256 and add `Bash(<path>:*)` to `.claude/settings.json`.

Under `~/.claude/toolsmith/` (same registry schema):

- `registry.json` — the user's global tools and their approval state (not
  committed).
- `config.json` — optional watchlist overrides that apply to every project
  (layered under a project's own `config.json`; see
  `skills/toolsmith/references/registry-schema.md`).
- `tools/<name>` — the global scripts themselves.

Global scripts are approved via `/toolsmith:approve <name>` (which runs
`scripts/toolsmith.mjs approve --user`, or `--user --dry-run` to preview) to
pin their sha256 and add `Bash(<absolute-path>:*)` to `~/.claude/settings.json`.

## Escape hatch & posture

Set `CLAUDE_TOOLSMITH_HOOK=off` to disable both hooks. The hooks **fail open**
on any internal error — the permission system, not this plugin, is the security
boundary; this is a guidance and redirection layer.

## Harness support

Works on Claude Code, Codex, and Cursor. The hooks accept both the
Bash/`PreToolUse` dialect (Claude, Codex) and the Shell/`preToolUse` dialect
(Cursor), and are built for all three targets via the repo's `aipm` toolkit
from the same source.

## Where this is heading

This README documents the shipped 0.3.x plugin: hash-pinned approvals plus a
`settings.json` allowlist rule per tool, one human proofread per script
version. The repo also carries the toolsmith **v2 design canon** under
[`docs/toolsmith/`](../../docs/toolsmith/architecture-steer.md) (start there),
which describes the next generation: cryptographically signed admission (not
just a hash pin), scoped/expiring usage grants, a curator sub-agent that
proposes and evolves the toolbox, and a forge runtime SDK. None of that is
implemented yet — this plugin is the current, shipped behavior; the canon is
the direction.

## Development

Regression tests are vitest suites at the repo root — `pnpm test` runs them
all (`tests/toolsmith-hooks.test.ts` for the hook trio,
`packages/toolsmith/tests/` for the `toolsmith` CLI). A thin bash smoke test
exercises the real hook wiring end to end:

```bash
bash scripts/smoke.sh
```

The CLI itself is `@mike-north/toolsmith` (`packages/toolsmith/`); the copy at
`scripts/toolsmith.mjs` is its committed build — edit the TypeScript source and
run `pnpm --filter @mike-north/toolsmith build`, never the bundle directly.

Benchmark the PreToolUse hot path (not wired into CI — perf numbers are
machine-dependent; run it locally when evaluating a change to
`toolsmith-gate.sh` or the payload-adapter adoption question for it, see #38):

```bash
bash scripts/bench.sh [iterations]   # default 50 timed runs per case
```

## License

ISC
