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

# --- user-scope fixture helpers ---------------------------------------------

new_home() {
  local home
  home=$(mktemp -d)
  mkdir -p "$home/.claude/toolsmith/tools"
  printf '%s\n' "$home"
}

write_user_tool() { # $1=home $2=name $3=content
  printf '%s' "$3" >"$1/.claude/toolsmith/tools/$2"
}

write_user_draft_registry() { # $1=home $2=name
  cat >"$1/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "$2",
      "path": "tools/$2",
      "purpose": "Do a narrow thing",
      "args": "<foo>",
      "scope": "repo (read-only)",
      "covers": ["some\\\\s+pattern"],
      "status": "draft",
      "approvedSha256": "",
      "permissionRule": ""
    }
  ]
}
EOF
}

run_approve_user() { # $1=home, shift args...
  local home="$1"
  shift
  HOME="$home" CLAUDE_PROJECT_DIR="/nonexistent-should-not-be-used" node "$APPROVE" "$@"
}

# ============================================================================
# 1. --dry-run (the new preview flag) changes nothing, prints hash + rule.
#    Flipped from the old bare-invocation preview test: bare now WRITES (see
#    case 2), so previewing requires --dry-run explicitly.
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")
EXPECT_SHA=$(shasum -a 256 "$PROJ/scripts/agent-tools/mytool" | awk '{print $1}')

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool --dry-run)
RC=$?
REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")

if [ "$RC" -eq 0 ] && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$PROJ/.claude/settings.json" ]; then ok; else
  bad "--dry-run leaves registry+settings untouched" "rc=$RC settings_exists=$([ -f "$PROJ/.claude/settings.json" ] && echo yes || echo no)"
fi

if printf '%s' "$OUT" | grep -qF "$EXPECT_SHA" && printf '%s' "$OUT" | grep -qF "Bash(scripts/agent-tools/mytool:*)" && printf '%s' "$OUT" | grep -qi "DRY RUN"; then
  ok
else
  bad "--dry-run prints hash + rule + DRY RUN" "$OUT"
fi
rm -rf "$PROJ"

# ============================================================================
# 2. bare <path> (no flags) is now the default and WRITES: pins
#    status/approvedSha256/permissionRule, adds rule to settings (creating
#    file + keys when absent). Flipped from the old `--commit` invocation,
#    since --commit no longer exists — the bare command now does what
#    --commit used to do.
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
EXPECT_SHA=$(shasum -a 256 "$PROJ/scripts/agent-tools/mytool" | awk '{print $1}')

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool)
RC=$?

STATUS=$(jq -r '.tools[0].status' "$PROJ/.claude/toolsmith/registry.json")
SHA=$(jq -r '.tools[0].approvedSha256' "$PROJ/.claude/toolsmith/registry.json")
RULE=$(jq -r '.tools[0].permissionRule' "$PROJ/.claude/toolsmith/registry.json")

if [ "$RC" -eq 0 ] && [ "$STATUS" = "approved" ] && [ "$SHA" = "$EXPECT_SHA" ] && [ "$RULE" = "Bash(scripts/agent-tools/mytool:*)" ]; then
  ok
else
  bad "bare approve pins registry fields" "status=$STATUS sha=$SHA rule=$RULE rc=$RC out=$OUT"
fi

if [ -f "$PROJ/.claude/settings.json" ] && jq -e '.permissions.allow == ["Bash(scripts/agent-tools/mytool:*)"]' "$PROJ/.claude/settings.json" >/dev/null 2>&1; then
  ok
else
  bad "bare approve creates settings.json with the rule" "$(cat "$PROJ/.claude/settings.json" 2>/dev/null)"
fi

if [ -x "$PROJ/scripts/agent-tools/mytool" ]; then ok; else bad "bare approve chmod +x the script" "not executable"; fi

# ============================================================================
# 3. hash parity: approvedSha256 equals shasum -a 256
# ============================================================================
if [ "$SHA" = "$EXPECT_SHA" ]; then ok; else bad "hash parity with shasum -a 256" "$SHA != $EXPECT_SHA"; fi

# ============================================================================
# 4. idempotency: two bare approve runs => exactly one rule, identical hash
#    (flipped from two `--commit` runs).
# ============================================================================
run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null
RULE_COUNT=$(jq '[.permissions.allow[] | select(. == "Bash(scripts/agent-tools/mytool:*)")] | length' "$PROJ/.claude/settings.json")
SHA2=$(jq -r '.tools[0].approvedSha256' "$PROJ/.claude/toolsmith/registry.json")
if [ "$RULE_COUNT" -eq 1 ] && [ "$SHA2" = "$EXPECT_SHA" ]; then ok; else bad "idempotent double bare-approve" "rule_count=$RULE_COUNT sha2=$SHA2"; fi
rm -rf "$PROJ"

# ============================================================================
# 5. path validation: absolute, .. traversal, backslash all rejected, under
#    BOTH bare (write-attempt) and --dry-run (preview) invocations. Flipped
#    from `--commit` to bare, since --commit no longer exists.
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")

run_approve "$PROJ" /etc/passwd >/dev/null 2>&1
RC1=$?
run_approve "$PROJ" "../etc/passwd" >/dev/null 2>&1
RC2=$?
run_approve "$PROJ" 'scripts\agent-tools\mytool' >/dev/null 2>&1
RC3=$?
run_approve "$PROJ" /etc/passwd --dry-run >/dev/null 2>&1
RC4=$?
run_approve "$PROJ" "../etc/passwd" --dry-run >/dev/null 2>&1
RC5=$?
run_approve "$PROJ" 'scripts\agent-tools\mytool' --dry-run >/dev/null 2>&1
RC6=$?

REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")
if [ "$RC1" -ne 0 ] && [ "$RC2" -ne 0 ] && [ "$RC3" -ne 0 ] && [ "$RC4" -ne 0 ] && [ "$RC5" -ne 0 ] && [ "$RC6" -ne 0 ] \
   && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$PROJ/.claude/settings.json" ]; then
  ok
else
  bad "invalid paths rejected under bare and --dry-run, nothing written" \
    "rc1=$RC1 rc2=$RC2 rc3=$RC3 rc4=$RC4 rc5=$RC5 rc6=$RC6"
fi
rm -rf "$PROJ"

# ============================================================================
# 5b. path validation: characters outside the safe set (rule-injection risk)
#     are rejected under BOTH bare (write-attempt) and --dry-run — e.g. `)`,
#     a space, `:`. Flipped from `--commit` to bare, and the old bare-preview
#     assertion to --dry-run, since bare now writes by default.
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")

run_approve "$PROJ" 'scripts/agent-tools/foo)bar' --dry-run >/dev/null 2>&1
RC_DRYRUN1=$?
run_approve "$PROJ" 'scripts/agent-tools/foo)bar' >/dev/null 2>&1
RC_BARE1=$?
run_approve "$PROJ" 'scripts/agent-tools/foo bar' >/dev/null 2>&1
RC_BARE2=$?
run_approve "$PROJ" 'scripts/agent-tools/foo:bar' >/dev/null 2>&1
RC_BARE3=$?

REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")
if [ "$RC_DRYRUN1" -ne 0 ] && [ "$RC_BARE1" -ne 0 ] && [ "$RC_BARE2" -ne 0 ] && [ "$RC_BARE3" -ne 0 ] \
   && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$PROJ/.claude/settings.json" ]; then
  ok
else
  bad "paths with special chars (')' space ':') rejected, nothing written" \
    "rc_dryrun1=$RC_DRYRUN1 rc_bare1=$RC_BARE1 rc_bare2=$RC_BARE2 rc_bare3=$RC_BARE3"
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
run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null 2>&1
RC=$?
if [ "$RC" -ne 0 ] && [ ! -f "$PROJ/.claude/settings.json" ]; then ok; else bad "missing registry entry refused" "rc=$RC"; fi
rm -rf "$PROJ"

# ============================================================================
# 7. missing script file => refuse
# ============================================================================
PROJ=$(new_proj)
write_draft_registry "$PROJ"
run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null 2>&1
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
run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null
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

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool 2>&1)
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

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool 2>&1)
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

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool 2>&1)
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
run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null

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
# 11. user scope: bare <name> --user approves — pins the user registry +
#     writes the fully-expanded absolute rule into $HOME/.claude/settings.json
#     (flipped from `--user --commit`); `--user --dry-run` previews instead
#     (flipped from the old bare `--user` preview). bare <name> normalizes to
#     tools/<name> either way.
# ============================================================================
HOME_DIR=$(new_home)
write_user_tool "$HOME_DIR" mytool $'#!/bin/bash\necho hi\n'
write_user_draft_registry "$HOME_DIR" mytool
ABS_SCRIPT="$HOME_DIR/.claude/toolsmith/tools/mytool"
EXPECT_SHA=$(shasum -a 256 "$ABS_SCRIPT" | awk '{print $1}')
EXPECT_RULE="Bash($ABS_SCRIPT:*)"

# --dry-run with a bare name (no "tools/" prefix) must resolve the same draft
# entry (i.e. normalize "mytool" -> "tools/mytool") and print the absolute path.
OUT=$(run_approve_user "$HOME_DIR" mytool --user --dry-run)
RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qF "$ABS_SCRIPT" && printf '%s' "$OUT" | grep -qF "$EXPECT_RULE" && printf '%s' "$OUT" | grep -qi "DRY RUN"; then
  ok
else
  bad "user --dry-run: bare name normalizes, prints absolute path + rule" "rc=$RC out=$OUT"
fi

OUT=$(run_approve_user "$HOME_DIR" mytool --user)
RC=$?
STATUS=$(jq -r '.tools[0].status' "$HOME_DIR/.claude/toolsmith/registry.json")
SHA=$(jq -r '.tools[0].approvedSha256' "$HOME_DIR/.claude/toolsmith/registry.json")
RULE=$(jq -r '.tools[0].permissionRule' "$HOME_DIR/.claude/toolsmith/registry.json")

if [ "$RC" -eq 0 ] && [ "$STATUS" = "approved" ] && [ "$SHA" = "$EXPECT_SHA" ] && [ "$RULE" = "$EXPECT_RULE" ]; then
  ok
else
  bad "user bare approve pins registry with fully-expanded absolute rule" "status=$STATUS sha=$SHA rule=$RULE rc=$RC out=$OUT"
fi

if [ -f "$HOME_DIR/.claude/settings.json" ] && jq -e --arg rule "$EXPECT_RULE" '.permissions.allow == [$rule]' "$HOME_DIR/.claude/settings.json" >/dev/null 2>&1; then
  ok
else
  bad "user bare approve writes the absolute rule into \$HOME/.claude/settings.json" "$(cat "$HOME_DIR/.claude/settings.json" 2>/dev/null)"
fi

if [ -x "$ABS_SCRIPT" ]; then ok; else bad "user bare approve chmod +x the script" "not executable"; fi
rm -rf "$HOME_DIR"

# ============================================================================
# 12. user scope: path validation rejects anything escaping tools/
#     (../evil, tools/../x, an absolute path) — non-zero, nothing written.
#     Flipped from `--user --commit` to bare `--user`.
# ============================================================================
HOME_DIR=$(new_home)
write_user_tool "$HOME_DIR" mytool $'#!/bin/bash\necho hi\n'
write_user_draft_registry "$HOME_DIR" mytool
REG_BEFORE=$(cat "$HOME_DIR/.claude/toolsmith/registry.json")

run_approve_user "$HOME_DIR" '../evil' --user >/dev/null 2>&1
RC1=$?
run_approve_user "$HOME_DIR" 'tools/../x' --user >/dev/null 2>&1
RC2=$?
run_approve_user "$HOME_DIR" '/etc/passwd' --user >/dev/null 2>&1
RC3=$?

REG_AFTER=$(cat "$HOME_DIR/.claude/toolsmith/registry.json")
if [ "$RC1" -ne 0 ] && [ "$RC2" -ne 0 ] && [ "$RC3" -ne 0 ] && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$HOME_DIR/.claude/settings.json" ]; then
  ok
else
  bad "user-scope paths escaping tools/ rejected, nothing written" "rc1=$RC1 rc2=$RC2 rc3=$RC3"
fi
rm -rf "$HOME_DIR"

# ============================================================================
# 13. user scope: malformed $HOME/.claude/settings.json fails the whole
#     approve closed (nothing written, registry stays draft). Flipped from
#     `--user --commit` to bare `--user`.
# ============================================================================
HOME_DIR=$(new_home)
write_user_tool "$HOME_DIR" mytool $'#!/bin/bash\necho hi\n'
write_user_draft_registry "$HOME_DIR" mytool
cat >"$HOME_DIR/.claude/settings.json" <<'EOF'
{
  "permissions": {
    "allow": ["Bash(important:*)"]
  },
EOF
# ^ deliberately truncated / invalid JSON.
SETTINGS_BEFORE=$(cat "$HOME_DIR/.claude/settings.json")
REG_BEFORE=$(cat "$HOME_DIR/.claude/toolsmith/registry.json")

OUT=$(run_approve_user "$HOME_DIR" mytool --user 2>&1)
RC=$?

SETTINGS_AFTER=$(cat "$HOME_DIR/.claude/settings.json")
REG_AFTER=$(cat "$HOME_DIR/.claude/toolsmith/registry.json")
REG_STATUS_AFTER=$(jq -r '.tools[0].status' "$HOME_DIR/.claude/toolsmith/registry.json" 2>/dev/null)

if [ "$RC" -ne 0 ] && [ "$SETTINGS_BEFORE" = "$SETTINGS_AFTER" ] && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ "$REG_STATUS_AFTER" = "draft" ]; then
  ok
else
  bad "user-scope malformed settings.json aborts entire commit (fail-closed)" \
    "rc=$RC reg_status=$REG_STATUS_AFTER out=$OUT"
fi
rm -rf "$HOME_DIR"

# ============================================================================
# 14. user scope: --verify --user reports OK / DRIFTED / MISSING
# ============================================================================
HOME_DIR=$(new_home)
write_user_tool "$HOME_DIR" mytool $'#!/bin/bash\necho hi\n'
write_user_draft_registry "$HOME_DIR" mytool
run_approve_user "$HOME_DIR" mytool --user >/dev/null

OUT=$(run_approve_user "$HOME_DIR" --verify --user)
RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qE '^OK\s'; then ok; else bad "user --verify OK when matching" "rc=$RC out=$OUT"; fi

printf '#!/bin/bash\necho DRIFTED\n' >"$HOME_DIR/.claude/toolsmith/tools/mytool"
OUT=$(run_approve_user "$HOME_DIR" --verify --user)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qE '^DRIFTED\s'; then ok; else bad "user --verify DRIFTED after edit" "rc=$RC out=$OUT"; fi

rm -f "$HOME_DIR/.claude/toolsmith/tools/mytool"
OUT=$(run_approve_user "$HOME_DIR" --verify --user)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qE '^MISSING\s'; then ok; else bad "user --verify MISSING after delete" "rc=$RC out=$OUT"; fi
rm -rf "$HOME_DIR"

# ============================================================================
# 15. project scope stays the default: a project-scope registry entry named
#     the same file must NOT be resolvable via --user, and vice versa
#     (defends against `resolveScope` accidentally being shared/mutated).
#     Uses --dry-run so this check stays side-effect free.
# ============================================================================
PROJ=$(new_proj)
write_tool "$PROJ" $'#!/bin/bash\necho hi\n'
write_draft_registry "$PROJ"
HOME_DIR=$(new_home)

OUT=$(HOME="$HOME_DIR" run_approve "$PROJ" scripts/agent-tools/mytool --dry-run)
RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qF "Bash(scripts/agent-tools/mytool:*)"; then
  ok
else
  bad "default (no --user) still previews the project-relative rule" "rc=$RC out=$OUT"
fi
rm -rf "$PROJ" "$HOME_DIR"

# ============================================================================
# 16. project root IS the home directory (issue #36): the "project" registry
#     path is then literally the same file as the user registry. Approving or
#     verifying WITHOUT --user must refuse with a clear pointer to --user
#     (fail-closed) rather than resolve script/settings paths against the
#     wrong root — which would either error confusingly ("script file not
#     found", since a user entry's `tools/<name>` path doesn't exist relative
#     to $HOME) or, worse, write a relative `Bash(tools/<name>:*)` rule that
#     can't match a $HOME-rooted session's allowlist. The identical scenario
#     WITH --user must still work normally (the guard only fires for the
#     project-scope branch).
# ============================================================================
HOME_DIR=$(new_home)
write_user_tool "$HOME_DIR" mytool $'#!/bin/bash\necho hi\n'
write_user_draft_registry "$HOME_DIR" mytool
REG_BEFORE=$(cat "$HOME_DIR/.claude/toolsmith/registry.json")

OUT=$(CLAUDE_PROJECT_DIR="$HOME_DIR" HOME="$HOME_DIR" node "$APPROVE" tools/mytool 2>&1)
RC=$?
REG_AFTER=$(cat "$HOME_DIR/.claude/toolsmith/registry.json")
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi -- '--user' \
   && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$HOME_DIR/.claude/settings.json" ]; then
  ok
else
  bad "\$HOME-rooted approve without --user refuses (fail-closed), nothing written" "rc=$RC out=$OUT"
fi

OUT=$(CLAUDE_PROJECT_DIR="$HOME_DIR" HOME="$HOME_DIR" node "$APPROVE" --verify 2>&1)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi -- '--user'; then
  ok
else
  bad "\$HOME-rooted verify without --user refuses" "rc=$RC out=$OUT"
fi

OUT=$(CLAUDE_PROJECT_DIR="$HOME_DIR" HOME="$HOME_DIR" node "$APPROVE" mytool --user 2>&1)
RC=$?
STATUS=$(jq -r '.tools[0].status' "$HOME_DIR/.claude/toolsmith/registry.json")
if [ "$RC" -eq 0 ] && [ "$STATUS" = "approved" ]; then
  ok
else
  bad "\$HOME-rooted approve WITH --user still works normally" "rc=$RC status=$STATUS out=$OUT"
fi
rm -rf "$HOME_DIR"

# ============================================================================
# summary
# ============================================================================
echo
echo "toolsmith-approve tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
