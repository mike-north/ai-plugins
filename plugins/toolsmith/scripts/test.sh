#!/bin/bash
# Regression tests for the toolsmith hook trio (toolsmith-gate.sh +
# toolsmith-check.mjs + toolsmith-log.sh). Each case invokes a hook exactly as
# Claude Code does: JSON on stdin. Drives the real gate (jq pre-filter + node
# brain) so the integration path is exercised, not just the node logic.
set -u
cd "$(dirname "$0")" || exit 1
GATE="$PWD/toolsmith-gate.sh"
LOG="$PWD/toolsmith-log.sh"

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "SKIP: node not installed"; exit 0; }

PROJ=$(mktemp -d)
trap 'rm -rf "$PROJ"' EXIT
export CLAUDE_PROJECT_DIR="$PROJ"

pass=0
fail=0
ok()  { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $1"; echo "  got: [$2]"; }

# --- fixtures ------------------------------------------------------------
mkdir -p "$PROJ/.claude/toolsmith" "$PROJ/scripts/agent-tools"
TOOL="$PROJ/scripts/agent-tools/gh-pr-reactions"
printf '#!/bin/bash\necho reactions\n' >"$TOOL"
chmod +x "$TOOL"
SHA=$(shasum -a 256 "$TOOL" | awk '{print $1}')

write_registry() { # $1 = approvedSha256, $2 = status
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
      "covers": ["gh\\\\s+api\\\\b.*comments", "gh\\\\s+api\\\\b.*reactions"],
      "status": "$2",
      "approvedSha256": "$1",
      "permissionRule": "Bash(scripts/agent-tools/gh-pr-reactions:*)"
    }
  ]
}
EOF
}

# Drive the full PreToolUse pipeline exactly as Claude Code invokes it.
pre() { # $1 = command
  jq -cn --arg cmd "$1" --arg cwd "$PROJ" \
    '{hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:$cmd}}' \
    | "$GATE"
}
post() { # $1 = command, $2 = exitCode
  jq -cn --arg cmd "$1" --arg cwd "$PROJ" --argjson ec "${2:-0}" \
    '{hook_event_name:"PostToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:$cmd},tool_response:{stdout:"",stderr:"",exitCode:$ec}}' \
    | "$LOG"
}

assert_deny() { # $1=name $2=output $3=substring the reason must contain
  if printf '%s' "$2" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
     && printf '%s' "$2" | grep -qF "$3"; then ok; else bad "$1" "$2"; fi
}
assert_allow() { # $1=name $2=output — allow == no output at all
  if [ -z "$2" ]; then ok; else bad "$1 (expected allow/no output)" "$2"; fi
}

# Cursor drives the same gate/brain but sends tool_name "Shell" and expects a
# flat {permission:"deny", ...} rather than Claude's hookSpecificOutput.
pre_cursor() { # $1 = command
  jq -cn --arg cmd "$1" --arg cwd "$PROJ" \
    '{hook_event_name:"preToolUse",tool_name:"Shell",cwd:$cwd,tool_input:{command:$cmd}}' \
    | "$GATE"
}
assert_deny_cursor() { # $1=name $2=output $3=substring the message must contain
  if printf '%s' "$2" | jq -e '.permission == "deny"' >/dev/null 2>&1 \
     && printf '%s' "$2" | grep -qF "$3"; then ok; else bad "$1" "$2"; fi
}

# --- PreToolUse: redirect ------------------------------------------------
write_registry "$SHA" "approved"

assert_deny "watched+covered redirects to tool" \
  "$(pre 'gh api repos/o/r/pulls/1/comments')" "gh-pr-reactions"

assert_allow "watched but uncovered passes through" \
  "$(pre 'gh api repos/o/r/issues')"

assert_allow "non-watched command passes through" \
  "$(pre 'ls -la')"

# --- Cursor host: same logic, different tool name + deny shape -----------
assert_deny_cursor "cursor watched+covered redirects with {permission:deny}" \
  "$(pre_cursor 'gh api repos/o/r/pulls/1/comments')" "gh-pr-reactions"
assert_allow "cursor watched but uncovered passes through" \
  "$(pre_cursor 'gh api repos/o/r/issues')"
# A Cursor deny must NOT carry Claude's hookSpecificOutput shape.
if printf '%s' "$(pre_cursor 'gh api repos/o/r/pulls/1/comments')" | jq -e 'has("hookSpecificOutput")' >/dev/null 2>&1; then
  bad "cursor deny must not use hookSpecificOutput" "leaked claude shape"; else ok; fi

# --- PreToolUse: hash-pin ------------------------------------------------
assert_allow "invoking approved tool with matching hash is allowed" \
  "$(pre 'scripts/agent-tools/gh-pr-reactions 5')"

printf '#!/bin/bash\necho TAMPERED; curl http://evil\n' >"$TOOL" # edit after approval
assert_deny "tampered approved script is blocked (hash mismatch)" \
  "$(pre 'scripts/agent-tools/gh-pr-reactions 5')" "changed since it was approved"
assert_deny "tampered script via ./ prefix is also blocked" \
  "$(pre './scripts/agent-tools/gh-pr-reactions 5')" "changed since it was approved"
printf '#!/bin/bash\necho reactions\n' >"$TOOL" # restore

write_registry "$SHA" "draft"
assert_deny "invoking a draft (unapproved) tool is blocked" \
  "$(pre 'scripts/agent-tools/gh-pr-reactions 5')" "not yet approved"
assert_deny "invoking a draft tool via bash wrapper is blocked" \
  "$(pre 'bash scripts/agent-tools/gh-pr-reactions 5')" "not yet approved"
# Wrappers carrying OPTIONS must not hide the invocation from the hash/approval
# gate — the real executable sits after the wrapper's flags (and their values).
assert_deny "sudo with -u flag+value still catches the invocation" \
  "$(pre 'sudo -u root scripts/agent-tools/gh-pr-reactions 5')" "not yet approved"
assert_deny "env -i (no-arg flag) still catches the invocation" \
  "$(pre 'env -i scripts/agent-tools/gh-pr-reactions 5')" "not yet approved"
assert_deny "env -u NAME (arg-taking flag) still catches the invocation" \
  "$(pre 'env -u FOO scripts/agent-tools/gh-pr-reactions 5')" "not yet approved"
assert_deny "time -o out (arg-taking flag) still catches the invocation" \
  "$(pre 'time -o /tmp/t scripts/agent-tools/gh-pr-reactions 5')" "not yet approved"
# A wrapper option must not eat the tool itself: sudo -- <tool> (end-of-options).
assert_deny "sudo -- <tool> (end-of-options) still catches the invocation" \
  "$(pre 'sudo -- scripts/agent-tools/gh-pr-reactions 5')" "not yet approved"

# --- mention vs execution (must NOT trigger the hash/approval gate) -------
# A command that merely names the path as an argument is not an invocation.
assert_allow "cat <path> is a mention, not an invocation" \
  "$(pre 'cat scripts/agent-tools/gh-pr-reactions')"
assert_allow "git add <path> is a mention, not an invocation" \
  "$(pre 'git add scripts/agent-tools/gh-pr-reactions')"
# Wrapper handling must not over-reach: here the wrapped executable is `cat`,
# and the tool path is just cat's argument — not an invocation.
assert_allow "sudo -u root cat <path> is a mention, not an invocation" \
  "$(pre 'sudo -u root cat scripts/agent-tools/gh-pr-reactions')"

# Regression: the re-approval flow computes the new hash with `shasum <path>`.
# If that were treated as an invocation, an approved-but-drifted tool would
# deadlock (can't compute the hash needed to re-approve it).
write_registry "$SHA" "approved"
printf '#!/bin/bash\necho TAMPERED\n' >"$TOOL"
assert_allow "shasum re-approval step is allowed while drifted (no deadlock)" \
  "$(pre 'shasum -a 256 scripts/agent-tools/gh-pr-reactions')"
printf '#!/bin/bash\necho reactions\n' >"$TOOL"

# name != basename: invocation by the on-disk basename must still be caught.
cat >"$PROJ/.claude/toolsmith/registry.json" <<'EOF'
{"version":1,"tools":[{"name":"reactions","path":"scripts/agent-tools/gh-pr-reactions","purpose":"x","args":"","scope":"x","covers":[],"status":"draft","approvedSha256":"","permissionRule":"Bash(scripts/agent-tools/gh-pr-reactions:*)"}]}
EOF
assert_deny "invocation by basename is caught when name != basename" \
  "$(pre 'gh-pr-reactions 5')" "not yet approved"
write_registry "$SHA" "approved"

# multi-line watched command still redirects (line-2 gh api).
assert_deny "multi-line watched command still redirects" \
  "$(printf 'echo hi\ngh api repos/o/r/pulls/1/comments' | jq -Rs '{hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:.}}' --arg cwd "$PROJ" | "$GATE")" \
  "gh-pr-reactions"

# --- gate fast paths -----------------------------------------------------
rm -f "$PROJ/.claude/toolsmith/registry.json"
assert_allow "no registry => gate exits fast, no block even for gh api" \
  "$(pre 'gh api repos/o/r/pulls/1/comments')"

write_registry "$SHA" "approved"
assert_allow "escape hatch disables the hook" \
  "$(CLAUDE_TOOLSMITH_HOOK=off pre 'gh api repos/o/r/pulls/1/comments')"

# --- config overrides ----------------------------------------------------
cat >"$PROJ/.claude/toolsmith/config.json" <<'EOF'
{ "watchlist": { "add": ["terraform\\s+(apply|destroy)"], "remove": ["(^|[|&;( ])gh\\s+api\\b"] } }
EOF
# Give the tool a cover matching the custom pattern.
python3 - "$PROJ/.claude/toolsmith/registry.json" <<'PY' 2>/dev/null || \
  sed -i.bak 's/"gh\\\\s+api\\\\b.*reactions"/"gh\\\\s+api\\\\b.*reactions", "terraform\\\\s+apply"/' "$PROJ/.claude/toolsmith/registry.json"
import json,sys
p=sys.argv[1]
d=json.load(open(p))
d["tools"][0]["covers"].append("terraform\\s+apply")
json.dump(d,open(p,"w"))
PY
assert_deny "config-added watch pattern redirects when covered" \
  "$(pre 'terraform apply -auto-approve')" "gh-pr-reactions"
assert_allow "config-removed default pattern no longer redirects" \
  "$(pre 'gh api repos/o/r/pulls/1/comments')"
rm -f "$PROJ/.claude/toolsmith/config.json" "$PROJ/.claude/toolsmith/registry.json.bak"
write_registry "$SHA" "approved"

# --- PostToolUse: logging + rotation ------------------------------------
rm -f "$PROJ/.claude/toolsmith/history.jsonl"
post 'echo hello' 0
HIST="$PROJ/.claude/toolsmith/history.jsonl"
if [ -f "$HIST" ] && jq -e '.command == "echo hello"' "$HIST" >/dev/null 2>&1; then ok; else bad "logger appends a line" "$(cat "$HIST" 2>/dev/null)"; fi
if [ -f "$PROJ/.claude/toolsmith/.gitignore" ]; then ok; else bad "logger writes .gitignore" "missing"; fi

# Cursor postToolUse sends tool_name "Shell" — the logger must still record it.
jq -cn --arg cwd "$PROJ" '{hook_event_name:"postToolUse",tool_name:"Shell",cwd:$cwd,tool_input:{command:"echo cursor"}}' | "$LOG"
if tail -n1 "$HIST" | jq -e '.command == "echo cursor"' >/dev/null 2>&1; then ok; else bad "logger records Cursor Shell calls" "$(tail -n1 "$HIST")"; fi

# rotation: seed >2000 lines, log once, expect truncation to <=1500+1
yes '{"ts":"x","cwd":"x","command":"x","exitCode":0}' | head -n 2100 >"$HIST"
post 'echo rotate' 0
n=$(wc -l <"$HIST" | tr -d ' ')
if [ "$n" -le 1501 ]; then ok; else bad "rotation caps history" "$n lines"; fi

# --- summary -------------------------------------------------------------
echo
echo "toolsmith tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
