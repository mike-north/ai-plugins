#!/bin/bash
# Thin end-to-end smoke test for the toolsmith hook trio, exercising the real
# wiring: PreToolUse -> toolsmith-gate.sh -> toolsmith-check.mjs, and
# PostToolUse -> toolsmith-log.sh. Not a substitute for the full regression
# coverage (tests/toolsmith-hooks.test.ts) --
# just a handful of representative cases confirming the trio is wired up and
# working end to end. Mirrors the old bash harness style (mktemp fixtures,
# CLAUDE_PROJECT_DIR/HOME isolation, pass/fail counters, non-zero exit on
# failure) but stays intentionally tiny.
set -u
cd "$(dirname "$0")" || exit 1
GATE="$PWD/toolsmith-gate.sh"
LOG="$PWD/toolsmith-log.sh"

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "SKIP: node not installed"; exit 0; }

PROJ=$(mktemp -d)
USERHOME=$(mktemp -d)
trap 'rm -rf "$PROJ" "$USERHOME"' EXIT
export CLAUDE_PROJECT_DIR="$PROJ"
export HOME="$USERHOME"

pass=0
fail=0
ok()  { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $1"; echo "  got: [$2]"; }

mkdir -p "$PROJ/.claude/toolsmith" "$PROJ/scripts/agent-tools"
TOOL="$PROJ/scripts/agent-tools/gh-pr-reactions"
printf '#!/bin/bash\necho reactions\n' >"$TOOL"
chmod +x "$TOOL"
SHA=$(shasum -a 256 "$TOOL" | awk '{print $1}')

pre() { # $1 = command
  jq -cn --arg cmd "$1" --arg cwd "$PROJ" \
    '{hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:$cmd}}' \
    | "$GATE"
}

# 1. Not opted in (no registry) => fast exit, allow.
OUT="$(pre 'gh api repos/o/r/pulls/1/comments')"
if [ -z "$OUT" ]; then ok; else bad "not-opted-in fast exit allows" "$OUT"; fi

cat >"$PROJ/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "gh-pr-reactions",
      "path": "scripts/agent-tools/gh-pr-reactions",
      "purpose": "Read emoji reactions on a PR's review comments",
      "args": "<pr-number>",
      "scope": "repo (read-only)",
      "covers": ["gh(_\\\\w+)?\\\\s+api\\\\b.*comments"],
      "status": "approved",
      "approvedSha256": "$SHA",
      "permissionRule": "Bash(scripts/agent-tools/gh-pr-reactions:*)"
    }
  ]
}
EOF

# 2. Watched+covered command is denied with a redirect naming the tool's path.
OUT="$(pre 'gh api repos/o/r/pulls/1/comments')"
if printf '%s' "$OUT" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
   && printf '%s' "$OUT" | grep -qF 'Run `scripts/agent-tools/gh-pr-reactions'; then ok; else
  bad "watched+covered command denied with redirect" "$OUT"
fi

# 3. Drifted-hash tool is denied.
printf '#!/bin/bash\necho TAMPERED\n' >"$TOOL"
OUT="$(pre 'scripts/agent-tools/gh-pr-reactions 5')"
if printf '%s' "$OUT" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
   && printf '%s' "$OUT" | grep -qF 'changed since it was approved'; then ok; else
  bad "drifted-hash tool is denied" "$OUT"
fi

# 4. PostToolUse logger appends a line.
jq -cn --arg cwd "$PROJ" '{hook_event_name:"PostToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:"echo smoke"},tool_response:{stdout:"",stderr:"",exitCode:0}}' | "$LOG"
HIST="$PROJ/.claude/toolsmith/history.jsonl"
if [ -f "$HIST" ] && jq -e '.command == "echo smoke"' "$HIST" >/dev/null 2>&1; then ok; else
  bad "PostToolUse logger appends a line" "$(cat "$HIST" 2>/dev/null)"
fi

echo
echo "toolsmith smoke: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
