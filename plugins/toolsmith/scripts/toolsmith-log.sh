#!/bin/bash
# PostToolUse Bash logger for the toolsmith plugin. Appends one compact JSON
# line per Bash call to <project>/.claude/toolsmith/history.jsonl so that
# /toolsmith:analyze can later mine the history for repeated broad-command
# usage worth turning into a purpose-built script. Best-effort and local:
# it never fails the tool call and only writes inside projects that already
# have a .claude/ directory (i.e. opted into Claude tooling).
[ "${CLAUDE_TOOLSMITH_HOOK:-}" = "off" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)

# The shell tool is `Bash` on Claude/Codex and `Shell` on Cursor.
tn=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)
[ "$tn" = "Bash" ] || [ "$tn" = "Shell" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-${CURSOR_PROJECT_DIR:-}}"
[ -n "$root" ] || root=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$root" ] || root="$PWD"
[ -d "$root/.claude" ] || exit 0

toolsmith_dir="$root/.claude/toolsmith"
mkdir -p "$toolsmith_dir" 2>/dev/null || exit 0

# history.jsonl is transient, machine-local signal — never commit it.
gi="$toolsmith_dir/.gitignore"
[ -f "$gi" ] || printf 'history.jsonl\n' >"$gi" 2>/dev/null

log="$toolsmith_dir/history.jsonl"

printf '%s' "$input" | jq -c \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{ts: $ts, cwd: (.cwd // null), command: (.tool_input.command // null), exitCode: (.tool_response.exitCode // .tool_response.exit_code // null)}' \
  >>"$log" 2>/dev/null || exit 0

# Rotation: keep the file bounded. When it exceeds 2000 lines, retain the most
# recent 1500 so analysis stays cheap and the log never grows without limit.
lines=$(wc -l <"$log" 2>/dev/null | tr -d ' ')
if [ -n "$lines" ] && [ "$lines" -gt 2000 ] 2>/dev/null; then
  tmp="$log.tmp.$$"
  tail -n 1500 "$log" >"$tmp" 2>/dev/null && mv "$tmp" "$log" 2>/dev/null
fi

exit 0
