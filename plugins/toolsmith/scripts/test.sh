#!/bin/bash
# Regression tests for the toolsmith hooks (toolsmith-gate.sh +
# toolsmith-check.mjs + toolsmith-log.sh + toolsmith-write-gate.sh +
# toolsmith-write-check.mjs). Each case invokes a hook exactly as Claude Code
# does: JSON on stdin. Drives the real gates (jq pre-filter + node brain) so
# the integration path is exercised, not just the node logic.
set -u
cd "$(dirname "$0")" || exit 1
GATE="$PWD/toolsmith-gate.sh"
LOG="$PWD/toolsmith-log.sh"
WRITEGATE="$PWD/toolsmith-write-gate.sh"

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "SKIP: node not installed"; exit 0; }

PROJ=$(mktemp -d)
USERHOME=$(mktemp -d)
trap 'rm -rf "$PROJ" "$USERHOME"' EXIT
export CLAUDE_PROJECT_DIR="$PROJ"
# The hook resolves user-scope tools via os.homedir(), which honors $HOME on
# unix — point it at an isolated temp dir so these tests never touch the
# real ~/.claude/toolsmith on the machine running them.
export HOME="$USERHOME"

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
      "covers": ["gh(_\\\\w+)?\\\\s+api\\\\b.*comments", "gh(_\\\\w+)?\\\\s+api\\\\b.*reactions", "gh(_\\\\w+)?\\\\s+graphql\\\\b.*orgs"],
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
# Append a `covers` pattern to a registry's first tool entry. Used by the
# config-layering tests below, which use simple literal watch tokens. jq is
# already a hard requirement of this suite, and --arg passes the pattern as
# data (no string interpolation into the edit).
add_cover() { # $1 = registry path, $2 = pattern to append
  local tmp="$1.tmp.$$"
  jq --arg c "$2" '.tools[0].covers += [$c]' "$1" >"$tmp" && mv "$tmp" "$1"
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

# Legacy path: pre-0.7.0-toolkit installs ship a pre-shim cursor.json that
# feeds tool_name "Shell" straight into the gate and expects a flat
# {permission:"deny", ...} rather than Claude's hookSpecificOutput. Current
# shipped installs route through cursor-shim.mjs, which rewrites Shell -> Bash
# before the gate ever sees it, so this exercises legacy direct-wiring
# compatibility only (see the isCursor comment in toolsmith-check.mjs).
pre_cursor() { # $1 = command
  jq -cn --arg cmd "$1" --arg cwd "$PROJ" \
    '{hook_event_name:"preToolUse",tool_name:"Shell",cwd:$cwd,tool_input:{command:$cmd}}' \
    | "$GATE"
}
assert_deny_cursor() { # $1=name $2=output $3=substring the message must contain
  if printf '%s' "$2" | jq -e '.permission == "deny"' >/dev/null 2>&1 \
     && printf '%s' "$2" | grep -qF "$3"; then ok; else bad "$1" "$2"; fi
}

# Drive the write-denial gate exactly as Claude Code invokes Write/Edit/
# NotebookEdit PreToolUse hooks. $1 = tool_name, $2 = the path field's name
# ("file_path" or "notebook_path"), $3 = the path value.
pre_write() { # $1 = tool_name, $2 = path field name, $3 = path value
  jq -cn --arg tool "$1" --arg field "$2" --arg path "$3" --arg cwd "$PROJ" \
    '{hook_event_name:"PreToolUse",tool_name:$tool,cwd:$cwd,tool_input:{($field):$path}}' \
    | "$WRITEGATE"
}

# --- PreToolUse: redirect ------------------------------------------------
write_registry "$SHA" "approved"

assert_deny "watched+covered redirects to tool" \
  "$(pre 'gh api repos/o/r/pulls/1/comments')" "gh-pr-reactions"

# The runnable command in the redirect MUST be the tool's PATH (what the
# `Bash(<path>:*)` allowlist rule actually matches), not the bare name —
# otherwise following the message literally still trips a permission prompt.
assert_deny "project-tool redirect's runnable command is the relative PATH form" \
  "$(pre 'gh api repos/o/r/pulls/1/comments')" 'Run `scripts/agent-tools/gh-pr-reactions'

assert_allow "watched but uncovered passes through" \
  "$(pre 'gh api repos/o/r/issues')"

assert_allow "non-watched command passes through" \
  "$(pre 'ls -la')"

# --- wrapper binaries (e.g. gh_dotcom) must be caught by the watchlist too --
# gh_dotcom (a common wrapper that pins gh to github.com) sails straight
# through the un-fixed `gh\s+api\b` / `gh\s+graphql\b` watchlist patterns,
# silently defeating the redirect — issue #36 bug 2.
assert_deny "gh_dotcom api wrapper form redirects same as bare gh api" \
  "$(pre 'gh_dotcom api repos/o/r/pulls/1/comments')" "gh-pr-reactions"
assert_allow "gh_dotcom api wrapper form, watched but uncovered, passes through" \
  "$(pre 'gh_dotcom api repos/o/r/issues')"
assert_deny "gh_dotcom graphql wrapper form redirects when covered" \
  "$(pre 'gh_dotcom graphql -f query=orgs')" "gh-pr-reactions"
assert_deny "bare gh graphql still redirects when covered (no regression)" \
  "$(pre 'gh graphql -f query=orgs')" "gh-pr-reactions"

# --- Cursor legacy direct-wiring: same logic, different tool name + deny shape
assert_deny_cursor "legacy pre-shim cursor watched+covered redirects with {permission:deny}" \
  "$(pre_cursor 'gh api repos/o/r/pulls/1/comments')" "gh-pr-reactions"
assert_allow "legacy pre-shim cursor watched but uncovered passes through" \
  "$(pre_cursor 'gh api repos/o/r/issues')"
# A legacy pre-shim Cursor deny must NOT carry Claude's hookSpecificOutput shape.
if printf '%s' "$(pre_cursor 'gh api repos/o/r/pulls/1/comments')" | jq -e 'has("hookSpecificOutput")' >/dev/null 2>&1; then
  bad "legacy pre-shim cursor deny must not use hookSpecificOutput" "leaked claude shape"; else ok; fi

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

# --- user scope: ~/.claude/toolsmith (no project registry present) ------
mkdir -p "$USERHOME/.claude/toolsmith/tools"
UTOOL="$USERHOME/.claude/toolsmith/tools/gh-user-tool"
printf '#!/bin/bash\necho user-tool\n' >"$UTOOL"
chmod +x "$UTOOL"
USHA=$(shasum -a 256 "$UTOOL" | awk '{print $1}')

write_user_registry() { # $1 = approvedSha256, $2 = status
  cat >"$USERHOME/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "gh-user-tool",
      "path": "tools/gh-user-tool",
      "purpose": "User-level test tool",
      "args": "",
      "scope": "repo (read-only)",
      "covers": ["gh\\\\s+api\\\\b.*orgs"],
      "status": "$2",
      "approvedSha256": "$1",
      "permissionRule": "Bash($UTOOL:*)"
    }
  ]
}
EOF
}

write_user_registry "$USHA" "approved"
assert_deny "user-level approved tool redirects a watched command with NO project registry" \
  "$(pre 'gh api repos/o/r/orgs')" "gh-user-tool"

# The runnable command in a USER-tool redirect MUST be the fully-expanded
# absolute path (what the `Bash(<ABS>:*)` allowlist rule matches) — a bare
# name or a `~/`-relative form would miss the rule and still prompt.
assert_deny "user-tool redirect's runnable command is the fully-expanded ABSOLUTE path" \
  "$(pre 'gh api repos/o/r/orgs')" "Run \`$UTOOL"

assert_allow "escape hatch disables the user-scope redirect too" \
  "$(CLAUDE_TOOLSMITH_HOOK=off pre 'gh api repos/o/r/orgs')"

assert_allow "invoking the approved user tool by absolute path is allowed" \
  "$(pre "$UTOOL")"

printf '#!/bin/bash\necho TAMPERED\n' >"$UTOOL" # edit after approval
assert_deny "user tool with a stale hash is blocked when invoked by absolute path" \
  "$(pre "$UTOOL")" "changed since it was approved"
printf '#!/bin/bash\necho user-tool\n' >"$UTOOL" # restore

write_user_registry "" "draft"
assert_deny "user tool with an absent hash (draft) is blocked when invoked by absolute path" \
  "$(pre "$UTOOL")" "not yet approved"
write_user_registry "$USHA" "approved"

# --- $HOME-rooted session: CLAUDE_PROJECT_DIR IS the home directory --------
# When a session's project root is $HOME, the "project" registry path
# (<root>/.claude/toolsmith/registry.json) IS the user registry file. Before
# the issue #36 fix, toolsmith-check.mjs ingested that file a second time as
# project scope, mis-tagging every user-tool entry (their `path` is relative
# to `<home>/.claude/toolsmith/`, not to `root`) — breaking both hash-pin
# ("could not be read" on a perfectly valid approved tool) and redirect
# (suggesting a bare `tools/<name>` path that can't match the user's absolute
# `Bash(<abs>:*)` allowlist rule). No project registry.json exists at this
# point in the run, matching the real-world repro (a session rooted at ~).
pre_homeroot() { # $1 = command
  jq -cn --arg cmd "$1" --arg cwd "$USERHOME" \
    '{hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:$cmd}}' \
    | CLAUDE_PROJECT_DIR="$USERHOME" "$GATE"
}

assert_allow "\$HOME-rooted session: approved user tool invoked by absolute path is allowed" \
  "$(pre_homeroot "$UTOOL")"

HOMEROOT_DENY="$(pre_homeroot 'gh api repos/o/r/orgs')"
assert_deny "\$HOME-rooted session: covered watched command is denied" \
  "$HOMEROOT_DENY" "gh-user-tool"
if printf '%s' "$HOMEROOT_DENY" | grep -qF "Run \`$UTOOL"; then ok; else
  bad "\$HOME-rooted session redirect names the ABSOLUTE tool path" "$HOMEROOT_DENY"
fi
if printf '%s' "$HOMEROOT_DENY" | grep -qF 'Run `tools/gh-user-tool'; then
  bad "\$HOME-rooted session redirect must not suggest the bare relative path" "$HOMEROOT_DENY"
else
  ok
fi

# --- project shadows a same-named user tool -------------------------------
# A project tool with the SAME `name` as a user tool must govern BOTH
# redirect and hash-pin; the user entry by that name is ignored while the
# project defines it.
PSHADOW="$PROJ/scripts/agent-tools/gh-user-tool"
mkdir -p "$(dirname "$PSHADOW")"
printf '#!/bin/bash\necho project-shadow\n' >"$PSHADOW"
chmod +x "$PSHADOW"
PSHA=$(shasum -a 256 "$PSHADOW" | awk '{print $1}')
cat >"$PROJ/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "gh-user-tool",
      "path": "scripts/agent-tools/gh-user-tool",
      "purpose": "Project tool shadowing a user tool of the same name",
      "args": "",
      "scope": "repo (read-only)",
      "covers": ["gh\\\\s+api\\\\b.*orgs"],
      "status": "approved",
      "approvedSha256": "$PSHA",
      "permissionRule": "Bash(scripts/agent-tools/gh-user-tool:*)"
    }
  ]
}
EOF

assert_deny "project tool shadows same-named user tool for redirect (names project path)" \
  "$(pre 'gh api repos/o/r/orgs')" "scripts/agent-tools/gh-user-tool"

# The user entry is a DRAFT (would deny "not yet approved" if it governed);
# the project entry is approved with a matching hash. Invoking via the user
# tool's absolute path must still resolve to the project's (approved) entry.
write_user_registry "$USHA" "draft"
assert_allow "project tool shadows same-named user tool for hash-pin (project entry governs)" \
  "$(pre "$UTOOL")"

# --- clean up user scope before the remaining (project-only) test cases --
rm -f "$USERHOME/.claude/toolsmith/registry.json"
rm -f "$PROJ/.claude/toolsmith/registry.json"

write_registry "$SHA" "approved"
assert_allow "escape hatch disables the hook" \
  "$(CLAUDE_TOOLSMITH_HOOK=off pre 'gh api repos/o/r/pulls/1/comments')"

# --- config overrides ----------------------------------------------------
cat >"$PROJ/.claude/toolsmith/config.json" <<'EOF'
{ "watchlist": { "add": ["terraform\\s+(apply|destroy)"], "remove": ["(^|[|&;( ])gh(_\\w+)?\\s+api\\b"] } }
EOF
# Give the tool a cover matching the custom pattern. The sed fallback
# generically appends after the covers array's closing `],` (via a capture
# group) rather than hardcoding the array's contents, so it stays correct
# regardless of the exact `covers` patterns write_registry() writes.
python3 - "$PROJ/.claude/toolsmith/registry.json" <<'PY' 2>/dev/null || \
  sed -i.bak -E 's/^(      "covers": \[.*)\],$/\1, "terraform\\\\s+apply"],/' "$PROJ/.claude/toolsmith/registry.json"
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

# --- user-global watchlist layer (issue #68) ------------------------------
# ~/.claude/toolsmith/config.json now participates in effectiveWatchlist(),
# layered broad->specific: shipped defaults -> user config -> project config.
rm -f "$PROJ/.claude/toolsmith/config.json" "$USERHOME/.claude/toolsmith/config.json"

# 1. user-add-in-bare-project: a project with NO config.json still honors a
#    user-scope watchlist.add — this is the case that regresses without the
#    fix (the pre-fix hook never reads ~/.claude/toolsmith/config.json at
#    all, so the command would pass straight through).
cat >"$USERHOME/.claude/toolsmith/config.json" <<'EOF'
{ "watchlist": { "add": ["zzuseraddwatch"] } }
EOF
add_cover "$PROJ/.claude/toolsmith/registry.json" "zzuseraddwatch"
assert_deny "user-add-in-bare-project: user-scope watchlist.add redirects with no project config" \
  "$(pre 'echo zzuseraddwatch')" "gh-pr-reactions"
rm -f "$USERHOME/.claude/toolsmith/config.json"

# 2. merge-precedence: user adds A, project adds B and removes A. Effective
#    watchlist must contain B, not A, and still carry an untouched default.
cat >"$USERHOME/.claude/toolsmith/config.json" <<'EOF'
{ "watchlist": { "add": ["zzmergeA"] } }
EOF
cat >"$PROJ/.claude/toolsmith/config.json" <<'EOF'
{ "watchlist": { "add": ["zzmergeB"], "remove": ["zzmergeA"] } }
EOF
add_cover "$PROJ/.claude/toolsmith/registry.json" "zzmergeA"
add_cover "$PROJ/.claude/toolsmith/registry.json" "zzmergeB"
assert_deny "merge-precedence: project's add (B) redirects" \
  "$(pre 'echo zzmergeB')" "gh-pr-reactions"
assert_allow "merge-precedence: project's remove drops the user's add (A)" \
  "$(pre 'echo zzmergeA')"
assert_deny "merge-precedence: an untouched shipped default is still watched" \
  "$(pre 'gh api repos/o/r/pulls/1/comments')" "gh-pr-reactions"
rm -f "$USERHOME/.claude/toolsmith/config.json" "$PROJ/.claude/toolsmith/config.json"
write_registry "$SHA" "approved"

# 3. user-remove-drops-default: a user-scope remove drops a shipped default
#    globally (no project config re-adding it).
cat >"$USERHOME/.claude/toolsmith/config.json" <<'EOF'
{ "watchlist": { "remove": ["(^|[|&;( ])gh(_\\w+)?\\s+api\\b"] } }
EOF
assert_allow "user-remove-drops-default: user-scope remove drops a shipped default" \
  "$(pre 'gh api repos/o/r/pulls/1/comments')"
assert_deny "user-remove-drops-default: an untouched shipped default is unaffected" \
  "$(pre 'gh graphql -f query=orgs')" "gh-pr-reactions"
rm -f "$USERHOME/.claude/toolsmith/config.json"

# 4. no-user-config-noop: with no user config present, behavior is identical
#    to today (defaults +/- project config only).
cat >"$PROJ/.claude/toolsmith/config.json" <<'EOF'
{ "watchlist": { "add": ["zznoopadd"], "remove": ["(^|[|&;( ])kubectl\\s+"] } }
EOF
add_cover "$PROJ/.claude/toolsmith/registry.json" "zznoopadd"
assert_deny "no-user-config-noop: project add still redirects with no user config" \
  "$(pre 'echo zznoopadd')" "gh-pr-reactions"
assert_allow "no-user-config-noop: project remove still drops a default with no user config" \
  "$(pre 'kubectl get pods')"
assert_deny "no-user-config-noop: an untouched shipped default is unaffected" \
  "$(pre 'gh api repos/o/r/pulls/1/comments')" "gh-pr-reactions"
rm -f "$PROJ/.claude/toolsmith/config.json" "$PROJ/.claude/toolsmith/registry.json.bak"
write_registry "$SHA" "approved"

# 5. home-rooted-no-double-apply: when the session root IS $HOME, the
#    "project" config.json path and the user config.json path resolve to the
#    SAME file (mirrors the registry's projectIsUserRegistry guard, issue
#    #36). It must be applied once, not twice: a user add still redirects
#    (proving the layer is actually applied) and the hook emits exactly one
#    well-formed deny — not a doubled/duplicated result.
write_user_registry "$USHA" "approved"
cat >"$USERHOME/.claude/toolsmith/config.json" <<'EOF'
{ "watchlist": { "add": ["zzhomeadd"] } }
EOF
add_cover "$USERHOME/.claude/toolsmith/registry.json" "zzhomeadd"
HOMEROOT_LAYER_DENY="$(pre_homeroot 'echo zzhomeadd')"
assert_deny "home-rooted-no-double-apply: user config (== project config here) redirects" \
  "$HOMEROOT_LAYER_DENY" "gh-user-tool"
if printf '%s' "$HOMEROOT_LAYER_DENY" | jq -e . >/dev/null 2>&1; then ok; else
  bad "home-rooted-no-double-apply: output must be a single well-formed JSON object" "$HOMEROOT_LAYER_DENY"
fi
rm -f "$USERHOME/.claude/toolsmith/config.json" "$USERHOME/.claude/toolsmith/registry.json"

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

# --- staged/live split (docs/toolsmith/staged-live-split.md) -------------
# Test-to-acceptance-criteria mapping for this section (the rest of the split's
# ACs — AC1, AC4, AC5, AC7 — are covered in test-approve.sh; see its header):
#   AC2 staged inert (both invocation routes)
#   AC3 live write-denied (mode/uchg + hashDenial never silently runs)
#   AC6 no hot-path regression (staging is invisible to the hook)
rm -f "$PROJ/.claude/toolsmith/registry.json" "$PROJ/.claude/toolsmith/config.json"
mkdir -p "$PROJ/.claude/toolsmith/staging"

CHFLAGS_AVAILABLE=0
command -v chflags >/dev/null 2>&1 && CHFLAGS_AVAILABLE=1

# --- AC2: staged is inert by construction, not by hook enforcement ---------
STAGED="$PROJ/.claude/toolsmith/staging/staged-tool"
printf '#!/bin/bash\necho staged\n' >"$STAGED"
# Deliberately NOT chmod +x'd and NOT referenced by any registry entry —
# matches how an agent-authored staging draft actually looks on disk.

# Route 1: direct execution attempt. This is a real filesystem property (no
# execute bit), not a hook decision — the hook doesn't even see this path.
if "$STAGED" >/dev/null 2>&1; then
  bad "AC2: staged draft is not directly executable (mode)" "ran successfully"
else
  ok
fi

# Route 2: interpreter invocation (`bash <staged>`). The hook must not
# recognize/redirect/grant it — it is simply not a registered tool, so it
# falls through untouched to the normal ask flow (no Bash(...) rule exists
# for a staging path, so the native permission system, not this hook, is
# what actually gates it at runtime).
assert_allow "AC2: staged draft via bash wrapper is not specially recognized by the hook" \
  "$(pre "bash $STAGED")"
assert_allow "AC2: staged draft invoked directly is not specially recognized by the hook" \
  "$(pre "$STAGED")"
rm -f "$STAGED"

# --- AC3: live write-denied (mode + uchg where available) -------------------
mkdir -p "$PROJ/scripts/agent-tools"
LIVE="$PROJ/scripts/agent-tools/protected-tool"
printf '#!/bin/bash\necho protected\n' >"$LIVE"
LIVE_SHA=$(shasum -a 256 "$LIVE" | awk '{print $1}')
chmod 0555 "$LIVE"
if [ "$CHFLAGS_AVAILABLE" -eq 1 ]; then chflags uchg "$LIVE" 2>/dev/null; fi

cat >"$PROJ/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "protected-tool",
      "path": "scripts/agent-tools/protected-tool",
      "purpose": "x", "args": "", "scope": "x", "covers": [],
      "status": "approved",
      "approvedSha256": "$LIVE_SHA",
      "permissionRule": "Bash(scripts/agent-tools/protected-tool:*)"
    }
  ]
}
EOF

# A direct write attempt to the live file fails (mode denies it) — this is a
# real write attempt, not a stat of the mode bits, and holds regardless of
# chflags availability (standard POSIX mode enforcement).
if { printf 'x' >>"$LIVE"; } 2>/dev/null; then
  bad "AC3: a protected live file's mode (0555) denies a direct write attempt" "write succeeded"
else
  ok
fi

# Invoking the still-matching, untampered live tool is allowed as normal.
assert_allow "AC3: an untampered protected live tool still invokes normally" \
  "$(pre 'scripts/agent-tools/protected-tool')"

if [ "$CHFLAGS_AVAILABLE" -eq 1 ]; then
  # Forced out-of-band edit (the same-user bypass the design's honest-limits
  # section names: nouchg is a distinct, greppable, two-step act, not an
  # accident). Even after that, the hook's hashDenial backstop (write-denial
  # layer 3) must refuse the drifted tool — it must NEVER silently run.
  chflags nouchg "$LIVE" 2>/dev/null
  chmod u+w "$LIVE"
  printf '#!/bin/bash\necho TAMPERED\n' >"$LIVE"
  chmod 0555 "$LIVE"
  chflags uchg "$LIVE" 2>/dev/null
  assert_deny "AC3: a forced out-of-band edit to a protected live tool is still refused (never silent-runs)" \
    "$(pre 'scripts/agent-tools/protected-tool')" "changed since it was approved"
  chflags nouchg "$LIVE" 2>/dev/null
else
  echo "SKIP: chflags not available on this platform — uchg-specific AC3 cases skipped (mode-only assertions above still ran)"
fi
rm -f "$LIVE"

# --- AC6: staging is invisible to the hot path — a "staged" field on an
# approved entry changes nothing about hash-pin or redirect behavior, and a
# malformed "staged" value doesn't perturb the hook (it never reads the key).
mkdir -p "$PROJ/scripts/agent-tools"
HOTPATH_TOOL="$PROJ/scripts/agent-tools/hotpath-tool"
printf '#!/bin/bash\necho hotpath\n' >"$HOTPATH_TOOL"
chmod +x "$HOTPATH_TOOL"
HOTPATH_SHA=$(shasum -a 256 "$HOTPATH_TOOL" | awk '{print $1}')

for STAGED_VALUE in \
  '{"path":".claude/toolsmith/staging/hotpath-tool","sha256":"x","note":"n","since":"2024-01-15T10:30:00.000Z"}' \
  '"a malformed string instead of an object"' \
  '12345' \
  'null'
do
  jq --arg sha "$HOTPATH_SHA" --argjson staged "$STAGED_VALUE" '{
    version: 1,
    tools: [{
      name: "hotpath-tool", path: "scripts/agent-tools/hotpath-tool",
      purpose: "x", args: "", scope: "x", covers: [],
      status: "approved", approvedSha256: $sha,
      permissionRule: "Bash(scripts/agent-tools/hotpath-tool:*)",
      staged: $staged
    }]
  }' -n >"$PROJ/.claude/toolsmith/registry.json"
  assert_allow "AC6: a 'staged' field (even malformed: $STAGED_VALUE) doesn't change hash-pin allow behavior" \
    "$(pre 'scripts/agent-tools/hotpath-tool')"
done
rm -f "$PROJ/.claude/toolsmith/registry.json" "$HOTPATH_TOOL"

# The not-opted-in fast path itself is entirely unchanged by this feature —
# toolsmith-check.mjs was not modified for the staged/live split at all, so
# the existing "no registry => gate exits fast" case earlier in this suite
# already covers it; this section only adds the "staged key present/malformed
# doesn't perturb behavior" invariant above.

# --- write-denial (layer 2): toolsmith-write-gate.sh + toolsmith-write-check.mjs
# Per docs/toolsmith/staged-live-split.md §write denial. Unconditional: no
# registry.json needed for any of these to fire.
rm -f "$PROJ/.claude/toolsmith/registry.json" "$PROJ/.claude/toolsmith/config.json"

mkdir -p "$PROJ/scripts/agent-tools" "$PROJ/.claude/toolsmith/staging" "$PROJ/.claude"
assert_deny "Write to a project live path is denied" \
  "$(pre_write Write file_path "$PROJ/scripts/agent-tools/x")" "write-protected"
assert_allow "Write to the project staging dir is allowed" \
  "$(pre_write Write file_path "$PROJ/.claude/toolsmith/staging/x")"
# settings.json is content-targeted (PR #137 review): only edits that
# INTRODUCE a Bash rule for a toolsmith live tool path are denied; every
# other settings edit — other permissions, hooks, env — passes through.
pre_edit_settings() { # $1 = path, $2 = old_string, $3 = new_string
  jq -cn --arg path "$1" --arg old "$2" --arg new "$3" --arg cwd "$PROJ" \
    '{hook_event_name:"PreToolUse",tool_name:"Edit",cwd:$cwd,tool_input:{file_path:$path,old_string:$old,new_string:$new}}' \
    | "$WRITEGATE"
}
pre_write_settings() { # $1 = path, $2 = content
  jq -cn --arg path "$1" --arg content "$2" --arg cwd "$PROJ" \
    '{hook_event_name:"PreToolUse",tool_name:"Write",cwd:$cwd,tool_input:{file_path:$path,content:$content}}' \
    | "$WRITEGATE"
}

assert_allow "settings.json edit adding an unrelated permission is allowed" \
  "$(pre_edit_settings "$PROJ/.claude/settings.json" '"allow": [' '"allow": ["Bash(npm test:*)",')"
assert_deny "settings.json edit introducing a project live-tool grant is denied" \
  "$(pre_edit_settings "$PROJ/.claude/settings.json" '"allow": [' '"allow": ["Bash(scripts/agent-tools/x:*)",')" "/toolsmith:approve"
assert_allow "settings.json edit that only carries an existing toolsmith rule as context is allowed" \
  "$(pre_edit_settings "$PROJ/.claude/settings.json" '"Bash(scripts/agent-tools/x:*)", "a"' '"Bash(scripts/agent-tools/x:*)", "b"')"
assert_deny "settings.json Write whose content adds a toolsmith grant is denied" \
  "$(pre_write_settings "$PROJ/.claude/settings.json" '{"permissions":{"allow":["Bash(scripts/agent-tools/x:*)"]}}')" "/toolsmith:approve"
assert_allow "settings.json Write without any toolsmith grant is allowed" \
  "$(pre_write_settings "$PROJ/.claude/settings.json" '{"permissions":{"allow":["Bash(npm test:*)"]}}')"

mkdir -p "$USERHOME/.claude"
assert_deny "user (~) settings.json edit introducing a user live-tool grant is denied" \
  "$(pre_edit_settings "$USERHOME/.claude/settings.json" '"allow": [' "\"allow\": [\"Bash($USERHOME/.claude/toolsmith/tools/y:*)\",")" "/toolsmith:approve"
assert_allow "user (~) settings.json edit without a toolsmith grant is allowed" \
  "$(pre_edit_settings "$USERHOME/.claude/settings.json" '"model": "opus"' '"model": "sonnet"')"

mkdir -p "$USERHOME/.claude/toolsmith/tools"
assert_deny "NotebookEdit of a user live path is denied" \
  "$(pre_write NotebookEdit notebook_path "$USERHOME/.claude/toolsmith/tools/nb.ipynb")" "write-protected"

assert_allow "Write to a path outside any protected dir is allowed" \
  "$(pre_write Write file_path "$PROJ/src/index.ts")"

assert_allow "escape hatch disables the write-denial hook too" \
  "$(CLAUDE_TOOLSMITH_HOOK=off pre_write Write file_path "$PROJ/scripts/agent-tools/x")"

# --- history.jsonl: raw Read denied, redacting reader works ----------------
mkdir -p "$PROJ/.claude/toolsmith"
assert_deny "raw Read of history.jsonl is denied with a steer to the reader" \
  "$(pre_write Read file_path "$PROJ/.claude/toolsmith/history.jsonl")" "toolsmith-history"
assert_allow "Read of an ordinary file is allowed" \
  "$(pre_write Read file_path "$PROJ/src/index.ts")"
assert_deny "Write to history.jsonl is denied too" \
  "$(pre_write Write file_path "$PROJ/.claude/toolsmith/history.jsonl")" "toolsmith-history"

HISTORY_READER="$PWD/toolsmith-history.mjs"
cat >"$PROJ/.claude/toolsmith/history.jsonl" <<'EOF'
{"ts":"2024-01-15T10:30:00.000Z","cwd":"/p","command":"gh api repos/o/r -H 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789'","exitCode":0}
{"ts":"2024-01-15T10:31:00.000Z","cwd":"/p","command":"AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY aws s3 ls","exitCode":0}
{"ts":"2024-01-15T10:32:00.000Z","cwd":"/p","command":"curl https://user:hunter2secret@example.com/api | jq .","exitCode":0}
{"ts":"2024-01-15T10:33:00.000Z","cwd":"/p","command":"gh pr list --limit 5","exitCode":0}
EOF
HOUT=$(CLAUDE_PROJECT_DIR="$PROJ" node "$HISTORY_READER")
if echo "$HOUT" | grep -q 'REDACTED' \
  && ! echo "$HOUT" | grep -q 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' \
  && ! echo "$HOUT" | grep -q 'wJalrXUtnFEMI' \
  && ! echo "$HOUT" | grep -q 'hunter2secret' \
  && echo "$HOUT" | grep -q 'gh pr list --limit 5'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1)); echo "FAIL: history reader redacts secret-like values"; echo "  got: [$HOUT]"
fi
HGREP=$(CLAUDE_PROJECT_DIR="$PROJ" node "$HISTORY_READER" --grep 'gh pr list' | wc -l | tr -d ' ')
if [ "$HGREP" = "1" ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1)); echo "FAIL: history reader --grep filters on redacted text"; echo "  got: [$HGREP lines]"
fi
HLIMIT=$(CLAUDE_PROJECT_DIR="$PROJ" node "$HISTORY_READER" --limit 2 | wc -l | tr -d ' ')
if [ "$HLIMIT" = "2" ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1)); echo "FAIL: history reader --limit keeps most recent N"; echo "  got: [$HLIMIT lines]"
fi
rm -f "$PROJ/.claude/toolsmith/history.jsonl"

# --- approve-guard: best-effort nudge in toolsmith-check.mjs against a
# freehanded toolsmith-approve.mjs invocation (registry-independent — none of
# these cases have a registry.json present, proving the gate.sh prefilter
# adjustment lets them all reach the node brain).
rm -f "$PROJ/.claude/toolsmith/registry.json" "$USERHOME/.claude/toolsmith/registry.json"

assert_deny "bare toolsmith-approve.mjs invocation is denied" \
  "$(pre 'node scripts/toolsmith-approve.mjs scripts/agent-tools/gh-pr-reactions')" "/toolsmith:approve"
assert_allow "toolsmith-approve.mjs --dry-run is allowed" \
  "$(pre 'node scripts/toolsmith-approve.mjs scripts/agent-tools/gh-pr-reactions --dry-run')"
assert_deny "an env marker does not exempt a commit run (no agent escape exists)" \
  "$(pre 'CLAUDE_TOOLSMITH_APPROVE=1 node scripts/toolsmith-approve.mjs scripts/agent-tools/gh-pr-reactions')" "human"
assert_allow "toolsmith-approve.mjs --verify is allowed (read-only)" \
  "$(pre 'node scripts/toolsmith-approve.mjs --verify')"
assert_allow "escape hatch disables the approve-guard too" \
  "$(CLAUDE_TOOLSMITH_HOOK=off pre 'node scripts/toolsmith-approve.mjs scripts/agent-tools/gh-pr-reactions')"
# Regression (PR #137 review): the guard fires only on actual invocations,
# never on commands that merely mention the filename as a data argument.
assert_allow "reading toolsmith-approve.mjs with cat is not an invocation" \
  "$(pre 'cat plugins/toolsmith/scripts/toolsmith-approve.mjs')"
assert_allow "grepping toolsmith-approve.mjs is not an invocation" \
  "$(pre 'grep -n seal plugins/toolsmith/scripts/toolsmith-approve.mjs')"
assert_allow "rg with the filename as a pattern is not an invocation" \
  "$(pre 'rg toolsmith-approve.mjs plugins/')"
assert_deny "direct execution of toolsmith-approve.mjs is still denied" \
  "$(pre './plugins/toolsmith/scripts/toolsmith-approve.mjs scripts/agent-tools/x')" "/toolsmith:approve"
assert_deny "node invocation in a later pipeline segment is still denied" \
  "$(pre 'echo ok && node plugins/toolsmith/scripts/toolsmith-approve.mjs scripts/agent-tools/x')" "/toolsmith:approve"

# --- summary -------------------------------------------------------------
echo
echo "toolsmith tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
