#!/bin/bash
# Regression tests for toolsmith-approve.mjs (the write/approve side of the
# proofread-then-allowlist handshake). Mirrors the style of test.sh: mktemp
# project fixtures, CLAUDE_PROJECT_DIR set, pass/fail counters, non-zero exit
# on any failure.
set -u
cd "$(dirname "$0")" || exit 1
APPROVE="$PWD/toolsmith-approve.mjs"

command -v node >/dev/null 2>&1 || { echo "SKIP: node not installed"; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed"; exit 0; }

pass=0
fail=0
ok()  { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $1"; echo "  got: [$2]"; }

# --- fixture helpers -------------------------------------------------------

new_proj() {
  local proj
  proj=$(mktemp -d)
  mkdir -p "$proj/.claude/toolsmith" "$proj/scripts/agent-tools"
  printf '%s\n' "$proj"
}

write_tool() { # $1=proj $2=content
  printf '%s' "$2" >"$1/scripts/agent-tools/mytool"
}

write_draft_registry() { # $1=proj
  cat >"$1/.claude/toolsmith/registry.json" <<'EOF'
{
  "version": 1,
  "tools": [
    {
      "name": "mytool",
      "path": "scripts/agent-tools/mytool",
      "purpose": "Do a narrow thing",
      "args": "<foo>",
      "scope": "repo (read-only)",
      "covers": ["some\\s+pattern"],
      "status": "draft",
      "approvedSha256": "",
      "permissionRule": ""
    }
  ]
}
EOF
}

run_approve() { # $1=proj, shift args...
  local proj="$1"
  shift
  CLAUDE_PROJECT_DIR="$proj" node "$APPROVE" "$@"
}

# ============================================================================
# 1. preview changes nothing, prints hash + rule
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")
EXPECT_SHA=$(shasum -a 256 "$PROJ/scripts/agent-tools/mytool" | awk '{print $1}')

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool)
RC=$?
REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")

if [ "$RC" -eq 0 ] && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$PROJ/.claude/settings.json" ]; then ok; else
  bad "preview leaves registry+settings untouched" "rc=$RC settings_exists=$([ -f "$PROJ/.claude/settings.json" ] && echo yes || echo no)"
fi

if printf '%s' "$OUT" | grep -qF "$EXPECT_SHA" && printf '%s' "$OUT" | grep -qF "Bash(scripts/agent-tools/mytool:*)" && printf '%s' "$OUT" | grep -qi "DRY RUN"; then
  ok
else
  bad "preview prints hash + rule + DRY RUN" "$OUT"
fi
rm -rf "$PROJ"

# ============================================================================
# 2. commit pins status/approvedSha256/permissionRule, adds rule to settings
#    (creating file + keys when absent)
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
EXPECT_SHA=$(shasum -a 256 "$PROJ/scripts/agent-tools/mytool" | awk '{print $1}')

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool --commit)
RC=$?

STATUS=$(jq -r '.tools[0].status' "$PROJ/.claude/toolsmith/registry.json")
SHA=$(jq -r '.tools[0].approvedSha256' "$PROJ/.claude/toolsmith/registry.json")
RULE=$(jq -r '.tools[0].permissionRule' "$PROJ/.claude/toolsmith/registry.json")

if [ "$RC" -eq 0 ] && [ "$STATUS" = "approved" ] && [ "$SHA" = "$EXPECT_SHA" ] && [ "$RULE" = "Bash(scripts/agent-tools/mytool:*)" ]; then
  ok
else
  bad "commit pins registry fields" "status=$STATUS sha=$SHA rule=$RULE rc=$RC out=$OUT"
fi

if [ -f "$PROJ/.claude/settings.json" ] && jq -e '.permissions.allow == ["Bash(scripts/agent-tools/mytool:*)"]' "$PROJ/.claude/settings.json" >/dev/null 2>&1; then
  ok
else
  bad "commit creates settings.json with the rule" "$(cat "$PROJ/.claude/settings.json" 2>/dev/null)"
fi

if [ -x "$PROJ/scripts/agent-tools/mytool" ]; then ok; else bad "commit chmod +x the script" "not executable"; fi

# ============================================================================
# 3. hash parity: approvedSha256 equals shasum -a 256
# ============================================================================
if [ "$SHA" = "$EXPECT_SHA" ]; then ok; else bad "hash parity with shasum -a 256" "$SHA != $EXPECT_SHA"; fi

# ============================================================================
# 4. idempotency: two --commit runs => exactly one rule, identical hash
# ============================================================================
run_approve "$PROJ" scripts/agent-tools/mytool --commit >/dev/null
RULE_COUNT=$(jq '[.permissions.allow[] | select(. == "Bash(scripts/agent-tools/mytool:*)")] | length' "$PROJ/.claude/settings.json")
SHA2=$(jq -r '.tools[0].approvedSha256' "$PROJ/.claude/toolsmith/registry.json")
if [ "$RULE_COUNT" -eq 1 ] && [ "$SHA2" = "$EXPECT_SHA" ]; then ok; else bad "idempotent double-commit" "rule_count=$RULE_COUNT sha2=$SHA2"; fi
rm -rf "$PROJ"

# ============================================================================
# 5. path validation: absolute, .. traversal, backslash all rejected
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")

run_approve "$PROJ" /etc/passwd --commit >/dev/null 2>&1
RC1=$?
run_approve "$PROJ" "../etc/passwd" --commit >/dev/null 2>&1
RC2=$?
run_approve "$PROJ" 'scripts\agent-tools\mytool' --commit >/dev/null 2>&1
RC3=$?

REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")
if [ "$RC1" -ne 0 ] && [ "$RC2" -ne 0 ] && [ "$RC3" -ne 0 ] && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$PROJ/.claude/settings.json" ]; then
  ok
else
  bad "invalid paths rejected, nothing written" "rc1=$RC1 rc2=$RC2 rc3=$RC3"
fi
rm -rf "$PROJ"

# ============================================================================
# 5b. path validation: characters outside the safe set (rule-injection risk)
#     are rejected in BOTH preview and --commit — e.g. `)`, a space, `:`.
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")

run_approve "$PROJ" 'scripts/agent-tools/foo)bar' >/dev/null 2>&1
RC_PREVIEW1=$?
run_approve "$PROJ" 'scripts/agent-tools/foo)bar' --commit >/dev/null 2>&1
RC_COMMIT1=$?
run_approve "$PROJ" 'scripts/agent-tools/foo bar' --commit >/dev/null 2>&1
RC_COMMIT2=$?
run_approve "$PROJ" 'scripts/agent-tools/foo:bar' --commit >/dev/null 2>&1
RC_COMMIT3=$?

REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")
if [ "$RC_PREVIEW1" -ne 0 ] && [ "$RC_COMMIT1" -ne 0 ] && [ "$RC_COMMIT2" -ne 0 ] && [ "$RC_COMMIT3" -ne 0 ] \
   && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$PROJ/.claude/settings.json" ]; then
  ok
else
  bad "paths with special chars (')' space ':') rejected, nothing written" \
    "rc_preview1=$RC_PREVIEW1 rc_commit1=$RC_COMMIT1 rc_commit2=$RC_COMMIT2 rc_commit3=$RC_COMMIT3"
fi
rm -rf "$PROJ"

# ============================================================================
# 6. missing registry entry => refuse
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
cat >"$PROJ/.claude/toolsmith/registry.json" <<'EOF'
{"version":1,"tools":[]}
EOF
run_approve "$PROJ" scripts/agent-tools/mytool --commit >/dev/null 2>&1
RC=$?
if [ "$RC" -ne 0 ] && [ ! -f "$PROJ/.claude/settings.json" ]; then ok; else bad "missing registry entry refused" "rc=$RC"; fi
rm -rf "$PROJ"

# ============================================================================
# 7. missing script file => refuse
# ============================================================================
PROJ=$(new_proj)
write_draft_registry "$PROJ"
run_approve "$PROJ" scripts/agent-tools/mytool --commit >/dev/null 2>&1
RC=$?
if [ "$RC" -ne 0 ] && [ ! -f "$PROJ/.claude/settings.json" ]; then ok; else bad "missing script file refused" "rc=$RC"; fi
rm -rf "$PROJ"

# ============================================================================
# 8. settings.json with pre-existing unrelated allow rules preserved
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
cat >"$PROJ/.claude/settings.json" <<'EOF'
{
  "someOtherKey": "untouched",
  "permissions": {
    "allow": ["Bash(git status:*)", "Bash(ls:*)"]
  }
}
EOF
run_approve "$PROJ" scripts/agent-tools/mytool --commit >/dev/null
if jq -e '.permissions.allow | index("Bash(git status:*)") != null and index("Bash(ls:*)") != null and index("Bash(scripts/agent-tools/mytool:*)") != null' "$PROJ/.claude/settings.json" >/dev/null 2>&1 \
   && [ "$(jq -r '.someOtherKey' "$PROJ/.claude/settings.json")" = "untouched" ]; then
  ok
else
  bad "existing allow rules + other keys preserved" "$(cat "$PROJ/.claude/settings.json")"
fi
rm -rf "$PROJ"

# ============================================================================
# 8b. fail-closed regression: settings.json exists but is malformed JSON must
#     abort the WHOLE commit (nothing written, registry stays draft) rather
#     than falling through to `{}` and clobbering the existing rules.
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
cat >"$PROJ/.claude/settings.json" <<'EOF'
{
  "permissions": {
    "allow": ["Bash(important:*)"]
  },
EOF
# ^ deliberately truncated / invalid JSON (missing closing braces).
SETTINGS_BEFORE=$(cat "$PROJ/.claude/settings.json")
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool --commit 2>&1)
RC=$?

SETTINGS_AFTER=$(cat "$PROJ/.claude/settings.json")
REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")
REG_STATUS_AFTER=$(jq -r '.tools[0].status' "$PROJ/.claude/toolsmith/registry.json" 2>/dev/null)

if [ "$RC" -ne 0 ] && [ "$SETTINGS_BEFORE" = "$SETTINGS_AFTER" ] && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ "$REG_STATUS_AFTER" = "draft" ]; then
  ok
else
  bad "malformed settings.json aborts entire commit (fail-closed, nothing written)" \
    "rc=$RC settings_changed=$([ "$SETTINGS_BEFORE" = "$SETTINGS_AFTER" ] && echo no || echo yes) registry_changed=$([ "$REG_BEFORE" = "$REG_AFTER" ] && echo no || echo yes) reg_status=$REG_STATUS_AFTER out=$OUT"
fi
rm -rf "$PROJ"

# ============================================================================
# 8c. fail-closed regression: settings.json is valid JSON but permissions.allow
#     (or permissions itself) is the wrong shape must abort the whole commit
#     rather than silently coercing it to [] / {}.
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
cat >"$PROJ/.claude/settings.json" <<'EOF'
{
  "permissions": {
    "allow": "nope"
  }
}
EOF
SETTINGS_BEFORE=$(cat "$PROJ/.claude/settings.json")
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool --commit 2>&1)
RC=$?

SETTINGS_AFTER=$(cat "$PROJ/.claude/settings.json")
REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")
REG_STATUS_AFTER=$(jq -r '.tools[0].status' "$PROJ/.claude/toolsmith/registry.json" 2>/dev/null)

if [ "$RC" -ne 0 ] && [ "$SETTINGS_BEFORE" = "$SETTINGS_AFTER" ] && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ "$REG_STATUS_AFTER" = "draft" ]; then
  ok
else
  bad "non-array permissions.allow aborts entire commit (fail-closed)" \
    "rc=$RC reg_status=$REG_STATUS_AFTER out=$OUT"
fi
rm -rf "$PROJ"

PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
cat >"$PROJ/.claude/settings.json" <<'EOF'
{
  "permissions": "nope"
}
EOF
SETTINGS_BEFORE=$(cat "$PROJ/.claude/settings.json")
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool --commit 2>&1)
RC=$?

SETTINGS_AFTER=$(cat "$PROJ/.claude/settings.json")
REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")
REG_STATUS_AFTER=$(jq -r '.tools[0].status' "$PROJ/.claude/toolsmith/registry.json" 2>/dev/null)

if [ "$RC" -ne 0 ] && [ "$SETTINGS_BEFORE" = "$SETTINGS_AFTER" ] && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ "$REG_STATUS_AFTER" = "draft" ]; then
  ok
else
  bad "non-object permissions aborts entire commit (fail-closed)" \
    "rc=$RC reg_status=$REG_STATUS_AFTER out=$OUT"
fi
rm -rf "$PROJ"

# ============================================================================
# 9. verify: OK / DRIFTED / MISSING / draft
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
run_approve "$PROJ" scripts/agent-tools/mytool --commit >/dev/null

OUT=$(run_approve "$PROJ" --verify)
RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qE '^OK\s'; then ok; else bad "verify OK when matching" "rc=$RC out=$OUT"; fi

printf '#!/bin/bash\necho DRIFTED\n' >"$PROJ/scripts/agent-tools/mytool"
OUT=$(run_approve "$PROJ" --verify)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qE '^DRIFTED\s'; then ok; else bad "verify DRIFTED after edit" "rc=$RC out=$OUT"; fi

rm -f "$PROJ/scripts/agent-tools/mytool"
OUT=$(run_approve "$PROJ" --verify)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qE '^MISSING\s'; then ok; else bad "verify MISSING after delete" "rc=$RC out=$OUT"; fi
rm -rf "$PROJ"

PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
OUT=$(run_approve "$PROJ" --verify)
RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qE '^draft\s'; then ok; else bad "verify reports draft without failing" "rc=$RC out=$OUT"; fi
rm -rf "$PROJ"

# ============================================================================
# 10. verify: a tampered registry entry with an absolute path or ".." must
#     NOT be read/hashed outside the project root — report MISSING and fail
#     the run, while a valid sibling entry in the same registry still
#     verifies normally.
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
GOOD_SHA=$(shasum -a 256 "$PROJ/scripts/agent-tools/mytool" | awk '{print $1}')
# A real, readable file outside the project root that --verify must never
# touch even though a tampered entry points at it by absolute path.
OUTSIDE=$(mktemp)
printf 'not part of this project\n' >"$OUTSIDE"
OUTSIDE_SHA=$(shasum -a 256 "$OUTSIDE" | awk '{print $1}')

cat >"$PROJ/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "mytool",
      "path": "scripts/agent-tools/mytool",
      "purpose": "x",
      "args": "",
      "scope": "x",
      "covers": [],
      "status": "approved",
      "approvedSha256": "$GOOD_SHA",
      "permissionRule": "Bash(scripts/agent-tools/mytool:*)"
    },
    {
      "name": "tampered-absolute",
      "path": "$OUTSIDE",
      "purpose": "x",
      "args": "",
      "scope": "x",
      "covers": [],
      "status": "approved",
      "approvedSha256": "$OUTSIDE_SHA",
      "permissionRule": "Bash($OUTSIDE:*)"
    },
    {
      "name": "tampered-traversal",
      "path": "../../../../etc/passwd",
      "purpose": "x",
      "args": "",
      "scope": "x",
      "covers": [],
      "status": "approved",
      "approvedSha256": "deadbeef",
      "permissionRule": "Bash(../../../../etc/passwd:*)"
    }
  ]
}
EOF

OUT=$(run_approve "$PROJ" --verify)
RC=$?
rm -f "$OUTSIDE"

if [ "$RC" -ne 0 ] \
   && printf '%s' "$OUT" | grep -qE '^OK\s+mytool' \
   && printf '%s' "$OUT" | grep -qE '^MISSING\s+tampered-absolute' \
   && printf '%s' "$OUT" | grep -qE '^MISSING\s+tampered-traversal'; then
  ok
else
  bad "verify never reads outside project root for absolute/.. registry paths" "rc=$RC out=$OUT"
fi
rm -rf "$PROJ"

# ============================================================================
# summary
# ============================================================================
echo
echo "toolsmith-approve tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
