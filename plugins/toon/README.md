# TOON — token-efficient JSON tool output

Routes JSON-emitting Bash commands through the [TOON](https://github.com/toon-format/toon)
encoder, cutting the token cost of JSON tool results by roughly 40–60%. Fully deterministic —
no model in the detection loop.

## How it works

Two hooks on the `Bash` tool, one shared brain:

- **PreToolUse — rewrite at the source.** When the *final* pipeline stage of a command carries a
  high-confidence JSON signal — a JSON output flag (`--json`, `--format json`, `-o json`), a
  terminal `jq` without raw-output flags, or a registry-confirmed command signature — the command
  is rewritten to append `| toon-pipe` as the final stage. This catches large outputs that would
  otherwise be truncated before they could be converted. `toon-pipe` falls back to verbatim
  passthrough if the output isn't JSON, and `set -o pipefail` preserves the upstream exit code.
- **PostToolUse — ground truth + learning.** Anything the rewrite missed: if the actual output
  parses as a JSON object/array above ~300 chars, the tool result is replaced with TOON
  (`updatedToolOutput`) and the command's signature (e.g. `gh api`, `kubectl get`) is recorded in
  `~/.claude/toon/registry.json`. After **2 confirmations**, PreToolUse rewrites that command at
  the source. Truncated JSON (unparseable, ≥20k chars) is learned but not converted — exactly the
  class the source rewrite exists for.

A bash gate (`toon-gate.sh`) fronts both events: one `jq` call (~15ms) short-circuits the common
non-JSON path; node only starts for plausible candidates.

### Invariants

- `toon-pipe` is only ever **appended as the final stage** of the whole command — never inserted
  mid-pipeline (TOON into `jq` would break it). Commands already mentioning `toon` are untouched.
- Verbatim-output commands (`cat`/`head`/`tail` file dumps, `echo`, `printf`) are never converted
  or learned — the agent may need exact bytes.
- Conversion failure is never an error: `toon-pipe` passes through raw output and exits 0.

## Requirements

- The `toon` CLI on PATH: `npm i -g @toon-format/cli`. Without it, everything degrades to a no-op.
- `jq` and `node` on PATH.

## Tuning

- **Escape hatch:** `CLAUDE_TOON_HOOK=off` disables everything.
- **Registry:** `~/.claude/toon/registry.json` (override with `TOON_HOOK_REGISTRY`). Shared across
  installs so learning compounds; delete an entry to unlearn a command.
- Size threshold, confirmation count, and exclusion lists are constants at the top of
  `scripts/toon-hook.mjs`.
- Optional: add a permission allow rule for the appended pipe stage so pre-approved commands don't
  start prompting, e.g. `Bash(<plugin-root>/scripts/toon-pipe)`.

Safe to run alongside a standalone install of the same hooks: the second copy sees `toon` in the
command (PreToolUse) or non-JSON output (PostToolUse) and no-ops.

## Tests

`scripts/test.sh` — fixture-driven regression suite exercising the gate + hook exactly as the
host invokes them (stdin JSON), including the placement invariant and registry threshold.
