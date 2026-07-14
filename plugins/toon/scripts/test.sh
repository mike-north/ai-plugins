#!/bin/bash
# Regression tests for the toon hook pair (toon-hook.mjs + toon-pipe).
# Each case invokes the hook exactly as a host does: JSON on stdin.
# Covers both the Claude/Codex contract (hook_event_name, tool_response,
# hookSpecificOutput) and the Cursor contract (no hook_event_name, tool_output,
# updated_input; Post is a no-op since Cursor can't replace Shell output).
set -u
cd "$(dirname "$0")" || exit 1

REG_DIR=$(mktemp -d)
export TOON_HOOK_REGISTRY="$REG_DIR/registry.json"
trap 'rm -rf "$REG_DIR"' EXIT

pass=0
fail=0

ok()   { pass=$((pass + 1)); }
bad()  { fail=$((fail + 1)); echo "FAIL: $1"; echo "  got: $2"; }

# Drive the full pipeline (gate + node hook), exactly as Claude Code invokes it.
pre() {
  jq -cn --arg cmd "$1" \
    '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$cmd}}' \
    | ./toon-gate.sh
}

# Real Bash tool_response shape is {stdout, stderr, interrupted, isImage} —
# regression guard: an earlier version read the documented-but-wrong
# {type:"text", text} shape and silently no-op'd on every live event.
post() {
  jq -cn --arg cmd "$1" --arg out "$2" \
    '{hook_event_name:"PostToolUse",tool_name:"Bash",tool_input:{command:$cmd},tool_response:{stdout:$out,stderr:"",interrupted:false,isImage:false}}' \
    | ./toon-gate.sh
}

post_legacy() { # older/doc shape: {type:"text", text}
  jq -cn --arg cmd "$1" --arg out "$2" \
    '{hook_event_name:"PostToolUse",tool_name:"Bash",tool_input:{command:$cmd},tool_response:{type:"text",text:$out}}' \
    | ./toon-gate.sh
}

assert_rewrite() { # $1=name $2=hook output — must rewrite, ending in toon-pipe
  local out="$2"
  local newcmd
  newcmd=$(jq -r '.hookSpecificOutput.updatedInput.command // empty' <<<"$out" 2>/dev/null)
  if [[ "$newcmd" == "set -o pipefail; "*" | "*"/toon-pipe" ]]; then ok; else bad "$1" "$out"; fi
}

assert_noop() { # $1=name $2=hook output — must emit nothing
  if [[ -z "$2" ]]; then ok; else bad "$1" "$2"; fi
}

# --- Cursor host (no hook_event_name; tool Shell; updated_input envelope) ------
cursor_pre() { # generic preToolUse payload — no output, no hook_event_name
  jq -cn --arg cmd "$1" \
    '{tool_name:"Shell",tool_input:{command:$cmd},tool_use_id:"abc",cwd:"/p"}' \
    | ./toon-gate.sh
}

cursor_post() { # generic postToolUse payload — carries tool_output
  jq -cn --arg cmd "$1" --arg out "$2" \
    '{tool_name:"Shell",tool_input:{command:$cmd},tool_output:$out,tool_use_id:"abc",duration:12}' \
    | ./toon-gate.sh
}

assert_cursor_rewrite() { # rewrite via Cursor's updated_input envelope
  local out="$2" newcmd
  newcmd=$(jq -r '.updated_input.command // empty' <<<"$out" 2>/dev/null)
  if [[ "$newcmd" == "set -o pipefail; "*" | "*"/toon-pipe" ]]; then ok; else bad "$1" "$out"; fi
}

BIG_JSON=$(jq -cn '[range(30) | {id:., name:("item-"+tostring), state:"open"}]')

# --- PreToolUse: positive signals -------------------------------------------
assert_rewrite "json flag: gh --json"        "$(pre 'gh pr view 42 --json state,title')"
assert_rewrite "json flag: kubectl -o json"  "$(pre 'kubectl get pods -o json')"
assert_rewrite "json flag: --format=json"    "$(pre 'aws s3api list-buckets --format=json')"
assert_rewrite "terminal jq"                 "$(pre 'gh api repos/x/y | jq ".items"')"
assert_rewrite "flag only in final segment"  "$(pre 'git fetch && gh pr list --json number')"
# `|&` (pipe stdout+stderr) is a pipe, not a segment break — terminal jq detected.
assert_rewrite "|& pipe to terminal jq"      "$(pre 'gh api repos/x/y |& jq ".items"')"
# `toon` only as an ARGUMENT substring (repo name), not an invoked stage — must
# still be rewritten, not skipped by the toon guard.
assert_rewrite "toon in arg, terminal jq"    "$(pre 'gh api repos/toon-format/toon | jq ".x"')"
assert_rewrite "toon in arg, json flag"      "$(pre 'gh api repos/toon-format/toon --json name')"

# --- PreToolUse: negative / placement invariant ------------------------------
assert_noop "jq -r is raw output"            "$(pre 'gh api x | jq -r ".name"')"
assert_noop "jq combined short flag -er"     "$(pre 'gh api x | jq -er ".name"')"
assert_noop "multi-line command"             "$(pre $'gh pr list --json number\necho done')"
assert_noop "heredoc"                        "$(pre 'cat <<EOF --json
EOF')"
assert_noop "already piped to toon"          "$(pre 'gh pr view --json state | toon')"
assert_noop "already piped to toon-pipe path" "$(pre 'set -o pipefail; gh pr view --json state | /Users/x/.claude/plugins/cache/ai-plugins/toon/0.1.0/scripts/toon-pipe')"
assert_noop "invokes toon directly"          "$(pre 'toon data.json')"
assert_noop "output redirection"             "$(pre 'kubectl get pods -o json > out.json')"
assert_noop "backgrounded command"           "$(pre 'gh pr list --json number &')"
assert_noop "JSON stage not final (grep)"    "$(pre 'gh api x | jq ".a" | grep b')"
assert_noop "unbalanced quote"               "$(pre 'gh pr list --json number "')"
assert_noop "plain command, no signal"       "$(pre 'ls -la')"

# --- PostToolUse: convert + learn --------------------------------------------
out=$(post 'gh api user/repos' "$BIG_JSON")
toon_text=$(jq -r '.hookSpecificOutput.updatedToolOutput.stdout // empty' <<<"$out" 2>/dev/null)
if [[ "$toon_text" == *'[30]{id,name,state}'* ]]; then ok; else bad "post: converts big JSON to TOON (stdout swapped in object shape)" "$out"; fi
if jq -e '.hookSpecificOutput.updatedToolOutput | .stderr == "" and .interrupted == false' <<<"$out" >/dev/null 2>&1; then ok; else bad "post: preserves sibling tool_response fields" "$out"; fi
out=$(post_legacy 'legacycli fetch user/orgs' "$BIG_JSON")
toon_text=$(jq -r '.hookSpecificOutput.updatedToolOutput // empty' <<<"$out" 2>/dev/null)
if [[ "$toon_text" == *'[30]{id,name,state}'* ]]; then ok; else bad "post: legacy {type,text} shape converts to string output" "$out"; fi
if jq -e '.hookSpecificOutput.additionalContext | test("TOON")' <<<"$out" >/dev/null 2>&1; then ok; else bad "post: additionalContext note" "$out"; fi
count=$(jq -r '.[] | select(.sig == "gh api") | .count' "$TOON_HOOK_REGISTRY" 2>/dev/null)
if [[ "$count" == "1" ]]; then ok; else bad "post: registry learned 'gh api' (count 1)" "$(cat "$TOON_HOOK_REGISTRY" 2>/dev/null)"; fi

# --- Registry threshold: 1 confirmation is not enough, 2 is ------------------
assert_noop "registry count 1 → no pre-rewrite" "$(pre 'gh api user/repos')"
post 'gh api user/repos' "$BIG_JSON" >/dev/null
count=$(jq -r '.[] | select(.sig == "gh api") | .count' "$TOON_HOOK_REGISTRY")
if [[ "$count" == "2" ]]; then ok; else bad "post: second confirmation (count 2)" "$(cat "$TOON_HOOK_REGISTRY")"; fi
assert_rewrite "registry count 2 → pre-rewrite" "$(pre 'gh api user/repos')"

# --- PostToolUse: toon in arg (not a stage) → still converts + learns ---------
out=$(post 'gh api repos/toon-format/toon' "$BIG_JSON")
toon_text=$(jq -r '.hookSpecificOutput.updatedToolOutput.stdout // empty' <<<"$out" 2>/dev/null)
if [[ "$toon_text" == *'[30]{id,name,state}'* ]]; then ok; else bad "post: toon in arg still converted (not skipped)" "$out"; fi

# --- PostToolUse: negatives ---------------------------------------------------
assert_noop "post: non-JSON output"          "$(post 'gh pr checks' 'All checks passing')"
assert_noop "post: sub-threshold JSON"       "$(post 'gh api user' '{"login":"mike-north"}')"
assert_noop "post: cat file dump excluded"   "$(post 'cat package.json' "$BIG_JSON")"
assert_noop "post: echo not learned/converted" "$(post 'echo {}' "$BIG_JSON")"
if ! jq -e '.[] | select(.sig | startswith("cat"))' "$TOON_HOOK_REGISTRY" >/dev/null 2>&1; then ok; else bad "post: cat never learned" "$(cat "$TOON_HOOK_REGISTRY")"; fi

# --- PostToolUse: truncated JSON → learn-only ---------------------------------
TRUNCATED="[$(head -c 25000 /dev/zero | tr '\0' 'x' | sed 's/x/{"id":1},/g' | head -c 25000)"
assert_noop "post: truncated JSON not converted" "$(post 'flyctl machines list --json' "$TRUNCATED")"
if jq -e '.[] | select(.sig == "flyctl machines")' "$TOON_HOOK_REGISTRY" >/dev/null 2>&1; then ok; else bad "post: truncated JSON still learned" "$(cat "$TOON_HOOK_REGISTRY")"; fi

# --- toon-pipe wrapper ---------------------------------------------------------
wrapped=$(echo '{"items":[{"id":1,"name":"a"},{"id":2,"name":"b"}]}' | ./toon-pipe)
if [[ "$wrapped" == *'items[2]{id,name}'* ]]; then ok; else bad "toon-pipe: converts JSON" "$wrapped"; fi
passthru=$(echo 'plain text, not json' | ./toon-pipe; echo "exit=$?")
if [[ "$passthru" == $'plain text, not json\nexit=0' ]]; then ok; else bad "toon-pipe: passthrough + exit 0 on non-JSON" "$passthru"; fi

# --- Cursor host --------------------------------------------------------------
# Pre: rewrite via updated_input for the same high-confidence signals.
assert_cursor_rewrite "cursor pre: json flag"   "$(cursor_pre 'gh pr view 42 --json state')"
assert_cursor_rewrite "cursor pre: terminal jq" "$(cursor_pre 'gh api x | jq ".items"')"
assert_cursor_rewrite "cursor pre: |& term jq"  "$(cursor_pre 'gh api x |& jq ".y"')"
assert_cursor_rewrite "cursor pre: toon in arg" "$(cursor_pre 'gh api repos/toon-format/toon --json name')"
# Registry is shared across hosts: a count>=2 signature drives Cursor's rewrite.
printf '[{"sig":"kubectl get","count":2,"lastSeen":"2026-07-14T00:00:00.000Z"}]\n' > "$TOON_HOOK_REGISTRY"
assert_cursor_rewrite "cursor pre: shared registry sig" "$(cursor_pre 'kubectl get pods')"
: > "$TOON_HOOK_REGISTRY"  # reset
# Pre negatives.
assert_noop "cursor pre: no signal"          "$(cursor_pre 'ls -la')"
assert_noop "cursor pre: jq -r raw"          "$(cursor_pre 'gh api x | jq -r ".name"')"
assert_noop "cursor pre: already toon-piped" "$(cursor_pre 'set -o pipefail; gh api x | /p/toon-pipe')"
# Post: Cursor cannot replace Shell output → always a no-op, even for big JSON.
assert_noop "cursor post: big JSON no-op"    "$(cursor_post 'gh api user/repos' "$BIG_JSON")"

# --- Non-shell tool → gate skips before spawning node -------------------------
out=$(jq -cn '{hook_event_name:"PreToolUse",tool_name:"Read",tool_input:{command:"gh pr list --json x"}}' | ./toon-gate.sh)
assert_noop "gate: non-shell tool_name (Read) skipped" "$out"
out=$(jq -cn '{tool_name:"MCP:foo",tool_input:{command:"gh pr list --json x"}}' | ./toon-gate.sh)
assert_noop "gate: non-shell tool_name (MCP) skipped" "$out"

# --- Escape hatch ---------------------------------------------------------------
out=$(jq -cn '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:"gh pr list --json number"}}' | CLAUDE_TOON_HOOK=off ./toon-gate.sh)
assert_noop "CLAUDE_TOON_HOOK=off disables hook (gate)" "$out"
out=$(jq -cn '{tool_name:"Shell",tool_input:{command:"gh pr list --json number"}}' | CLAUDE_TOON_HOOK=off ./toon-gate.sh)
assert_noop "CLAUDE_TOON_HOOK=off disables hook (cursor)" "$out"
out=$(jq -cn '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:"gh pr list --json number"}}' | CLAUDE_TOON_HOOK=off node toon-hook.mjs)
assert_noop "CLAUDE_TOON_HOOK=off disables hook (node)" "$out"

echo
echo "passed: $pass  failed: $fail"
[[ $fail -eq 0 ]]
