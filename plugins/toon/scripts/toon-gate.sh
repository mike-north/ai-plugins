#!/bin/bash
# Cheap gate in front of toon-hook.mjs. Runs on every Bash tool call (twice),
# so the common no-op path must stay fast: one jq invocation (~5ms) decides
# whether the event is even a candidate; node (~90ms startup) only spawns for
# plausible JSON events, where the token savings dwarf the startup cost.
# The gate is deliberately loose (substring/regex) — toon-hook.mjs makes the
# precise decision (quote-aware parsing, registry count threshold, jq -r, ...).
[ "${CLAUDE_TOON_HOOK:-}" = "off" ] && exit 0

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Buffer stdin to a temp file once and feed both jq and node from it, rather
# than slurping the (potentially large) PostToolUse payload into a shell
# variable and re-piping a second copy. Fail open (no-op) if mktemp fails.
tmp=$(mktemp) || exit 0
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"

reg="${TOON_HOOK_REGISTRY:-$HOME/.claude/toon/registry.json}"
[ -f "$reg" ] || reg=/dev/null

# The toon-skip must match `toon`/`toon-pipe` only as an invoked command STAGE
# (start of command or after a stage operator, optional path prefix) — NOT as an
# argument substring like `gh api repos/toon-format/toon`. Mirrors TOON_STAGE_RE
# in toon-hook.mjs.
verdict=$(jq -r --slurpfile reg "$reg" '
  (.tool_input.command // "") as $c
  | if .tool_name != "Bash" or ($c | test("(^|[|&;(])\\s*(\\S*/)?toon(-pipe)?(\\s|$)")) then "skip"
    elif .hook_event_name == "PreToolUse" then
      if ($c | test("--json|--format[= ].?json|--output[= ].?json|-o[= ]?.?json|\\|&?\\s*jq\\b"))
         or ([($reg[0] // [])[].sig] | any(. as $s | $c | contains($s)))
      then "go" else "skip" end
    elif .hook_event_name == "PostToolUse" then
      (.tool_response.stdout // .tool_response.text // "") as $t
      | if ($t | length) > 300 and ($t | test("^\\s*[\\[{]")) then "go" else "skip" end
    else "skip" end
' < "$tmp" 2>/dev/null)

[ "$verdict" = "go" ] || exit 0
node "$dir/toon-hook.mjs" < "$tmp"
