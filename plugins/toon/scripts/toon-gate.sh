#!/bin/bash
# Cheap gate in front of toon-hook.mjs. Runs on every shell tool call (twice),
# so the common no-op path must stay fast: one jq invocation (~5ms) decides
# whether the event is even a candidate; node (~90ms startup) only spawns for
# plausible JSON events, where the token savings dwarf the startup cost.
# The gate is deliberately loose (substring/regex) — toon-hook.mjs makes the
# precise decision (quote-aware parsing, registry count threshold, jq -r, ...).
#
# Host-agnostic: Claude/Codex carry `hook_event_name` (Bash) and put output in
# `tool_response`; Cursor omits `hook_event_name` (Shell) and puts output in
# `tool_output`. Cursor's post is a no-op in toon-hook.mjs (it can't replace
# Shell output), so the gate skips post events that lack `hook_event_name`.
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
  (.tool_input.command // .command // "") as $c
  # phase: Claude/Codex via hook_event_name; Cursor via presence of tool_output.
  | (if .hook_event_name == "PreToolUse" then "pre"
     elif .hook_event_name == "PostToolUse" then "post"
     elif (.hook_event_name | type) == "string" then "other"
     elif (has("tool_output")) then "cursor-post"
     else "pre" end) as $phase
  | if ($c == "") or ($c | test("(^|[|&;(])\\s*(\\S*/)?toon(-pipe)?(\\s|$)")) then "skip"
    elif $phase == "pre" then
      if ($c | test("--json|--format[= ].?json|--output[= ].?json|-o[= ]?.?json|\\|&?\\s*jq\\b"))
         or ([($reg[0] // [])[].sig] | any(. as $s | $c | contains($s)))
      then "go" else "skip" end
    elif $phase == "post" then
      (.tool_response.stdout // .tool_response.text // "") as $t
      | if ($t | length) > 300 and ($t | test("^\\s*[\\[{]")) then "go" else "skip" end
    else "skip" end   # cursor-post (no output replacement) and other → skip
' < "$tmp" 2>/dev/null)

[ "$verdict" = "go" ] || exit 0
node "$dir/toon-hook.mjs" < "$tmp"
