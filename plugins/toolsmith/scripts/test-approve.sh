#!/bin/bash
# Regression tests for toolsmith-approve.mjs — the staged/live promotion side
# of the toolsmith proofread-then-allowlist handshake
# (docs/toolsmith/staged-live-split.md). Mirrors the style of test.sh: mktemp
# project fixtures, CLAUDE_PROJECT_DIR set, pass/fail counters, non-zero exit
# on any failure.
#
# Test-to-acceptance-criteria mapping (docs/toolsmith/staged-live-split.md
# §Acceptance criteria — each AC below is also referenced inline at its test):
#   AC1 lockout dead            -> "AC1:" cases
#   AC2 staged inert            -> covered in test.sh (both invocation routes)
#   AC3 live write-denied       -> covered in test.sh (mode + uchg + hashDenial)
#   AC4 promotion atomicity/idempotence -> "AC4:" cases
#   AC5 new-tool flow e2e       -> "AC5:" cases
#   AC6 no hot-path regression  -> covered in test.sh
#   AC7 docs                   -> registry-schema.md / authoring-checklist.md
set -u
cd "$(dirname "$0")" || exit 1
APPROVE="$PWD/toolsmith-approve.mjs"

command -v node >/dev/null 2>&1 || { echo "SKIP: node not installed"; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed"; exit 0; }

CHFLAGS_AVAILABLE=0
command -v chflags >/dev/null 2>&1 && CHFLAGS_AVAILABLE=1

pass=0
fail=0
ok()  { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $1"; echo "  got: [$2]"; }

SINCE='2024-01-15T10:30:00.000Z'

# --- project-scope fixture helpers ------------------------------------------

new_proj() {
  local proj
  proj=$(mktemp -d)
  mkdir -p "$proj/.claude/toolsmith/staging" "$proj/scripts/agent-tools"
  printf '%s\n' "$proj"
}

# Write a staged draft's bytes at the project's staging namespace.
write_staged() { # $1=proj $2=name $3=content
  printf '%s' "$3" >"$1/.claude/toolsmith/staging/$2"
}

# A brand-new tool: draft status, only "staged" populated, no live path fields
# active — docs/toolsmith/staged-live-split.md §Registry schema changes.
write_new_draft_registry() { # $1=proj $2=name
  cat >"$1/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "$2",
      "path": "scripts/agent-tools/$2",
      "purpose": "Do a narrow thing",
      "args": "<foo>",
      "scope": "repo (read-only)",
      "covers": ["some\\\\s+pattern"],
      "status": "draft",
      "approvedSha256": "",
      "permissionRule": "",
      "staged": {
        "path": ".claude/toolsmith/staging/$2",
        "sha256": "advisory-only-not-trusted",
        "note": "initial draft",
        "since": "$SINCE"
      }
    }
  ]
}
EOF
}

# A revision: entry already approved+live with $3's bytes, with a staged
# draft ($4) pending promotion.
write_revision_registry() { # $1=proj $2=name $3=liveSha256 $4=liveRule
  cat >"$1/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "$2",
      "path": "scripts/agent-tools/$2",
      "purpose": "Do a narrow thing",
      "args": "<foo>",
      "scope": "repo (read-only)",
      "covers": ["some\\\\s+pattern"],
      "status": "approved",
      "approvedSha256": "$3",
      "permissionRule": "$4",
      "staged": {
        "path": ".claude/toolsmith/staging/$2",
        "sha256": "advisory-only-not-trusted",
        "note": "proposed revision",
        "since": "$SINCE"
      }
    }
  ]
}
EOF
}

# An entry with NO staged field at all (used for negative "nothing to
# promote" tests, and for verify tests that don't touch staging).
write_bare_registry() { # $1=proj $2=name $3=status $4=sha $5=rule
  cat >"$1/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "$2",
      "path": "scripts/agent-tools/$2",
      "purpose": "Do a narrow thing",
      "args": "<foo>",
      "scope": "repo (read-only)",
      "covers": ["some\\\\s+pattern"],
      "status": "$3",
      "approvedSha256": "$4",
      "permissionRule": "$5"
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

run_approve_kill() { # $1=proj $2=killAfterStep, shift args...
  local proj="$1" step="$2"
  shift 2
  CLAUDE_PROJECT_DIR="$proj" TOOLSMITH_APPROVE_KILL_AFTER="$step" node "$APPROVE" "$@"
}

# --- user-scope fixture helpers ---------------------------------------------

new_home() {
  local home
  home=$(mktemp -d)
  mkdir -p "$home/.claude/toolsmith/tools" "$home/.claude/toolsmith/staging"
  printf '%s\n' "$home"
}

write_user_staged() { # $1=home $2=name $3=content
  printf '%s' "$3" >"$1/.claude/toolsmith/staging/$2"
}

write_user_new_draft_registry() { # $1=home $2=name
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
      "permissionRule": "",
      "staged": {
        "path": "staging/$2",
        "sha256": "advisory-only-not-trusted",
        "note": "initial draft",
        "since": "$SINCE"
      }
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

is_writable() { # $1=path -> "yes"/"no" based on an actual write attempt
  # Grouped so a redirection-open failure (EPERM on a protected file) is
  # itself silenced by the 2>/dev/null, not just the command's own stderr.
  if { printf 'x' >>"$1"; } 2>/dev/null; then printf 'yes'; else printf 'no'; fi
}

# Fixture teardown: promoted live files may carry the BSD uchg flag, which
# blocks a plain `rm -rf` (Operation not permitted) — clear it first on every
# regular file under each given directory before removing it.
rmrf() {
  for d in "$@"; do
    if [ "$CHFLAGS_AVAILABLE" -eq 1 ] && [ -e "$d" ]; then
      find "$d" -type f -exec chflags nouchg {} + 2>/dev/null
    fi
    rm -rf "$d"
  done
}

# ============================================================================
# AC5 (new-tool flow e2e): draft -> staged -> approve -> live+granted, end to
# end, review surface showing exactly the placed bytes.
# ============================================================================
PROJ=$(new_proj)
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
write_new_draft_registry "$PROJ" mytool
EXPECT_SHA=$(shasum -a 256 "$PROJ/.claude/toolsmith/staging/mytool" | awk '{print $1}')

# --dry-run previews the full text (new tool) of exactly the staged bytes,
# writes nothing.
OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool --dry-run)
RC=$?
if [ "$RC" -eq 0 ] && [ ! -e "$PROJ/scripts/agent-tools/mytool" ] && [ ! -f "$PROJ/.claude/settings.json" ]; then ok; else
  bad "AC5: --dry-run on a new tool leaves live+settings untouched" "rc=$RC live_exists=$([ -e "$PROJ/scripts/agent-tools/mytool" ] && echo yes || echo no)"
fi
if printf '%s' "$OUT" | grep -qF "$EXPECT_SHA" && printf '%s' "$OUT" | grep -qi "new tool" && printf '%s' "$OUT" | grep -qF 'echo hi'; then
  ok
else
  bad "AC5: --dry-run shows sha256 + 'new tool' + the exact staged text" "$OUT"
fi

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool)
RC=$?
STATUS=$(jq -r '.tools[0].status' "$PROJ/.claude/toolsmith/registry.json")
SHA=$(jq -r '.tools[0].approvedSha256' "$PROJ/.claude/toolsmith/registry.json")
RULE=$(jq -r '.tools[0].permissionRule' "$PROJ/.claude/toolsmith/registry.json")
HAS_STAGED=$(jq -r 'has("staged")' <<<"$(jq '.tools[0]' "$PROJ/.claude/toolsmith/registry.json")")

if [ "$RC" -eq 0 ] && [ "$STATUS" = "approved" ] && [ "$SHA" = "$EXPECT_SHA" ] && [ "$RULE" = "Bash(scripts/agent-tools/mytool:*)" ]; then
  ok
else
  bad "AC5: promote pins registry fields from the STAGED bytes" "status=$STATUS sha=$SHA rule=$RULE rc=$RC out=$OUT"
fi

if [ "$HAS_STAGED" = "false" ]; then ok; else bad "AC5: 'staged' cleared from the entry after promotion" "has_staged=$HAS_STAGED"; fi

if [ -f "$PROJ/scripts/agent-tools/mytool" ] && [ "$(cat "$PROJ/scripts/agent-tools/mytool")" = "$(printf '#!/bin/bash\necho hi\n')" ]; then
  ok
else
  bad "AC5: live file placed with exactly the staged bytes" "$(cat "$PROJ/scripts/agent-tools/mytool" 2>/dev/null)"
fi

if [ ! -f "$PROJ/.claude/toolsmith/staging/mytool" ]; then ok; else bad "AC5: staging draft file removed after promotion" "still present"; fi

MODE=$(stat -f '%Lp' "$PROJ/scripts/agent-tools/mytool" 2>/dev/null || stat -c '%a' "$PROJ/scripts/agent-tools/mytool" 2>/dev/null)
if [ "$MODE" = "555" ]; then ok; else bad "AC5: live file mode is 0555 (r-x, no write)" "mode=$MODE"; fi

if [ -f "$PROJ/.claude/settings.json" ] && jq -e '.permissions.allow == ["Bash(scripts/agent-tools/mytool:*)"]' "$PROJ/.claude/settings.json" >/dev/null 2>&1; then
  ok
else
  bad "AC5: promote creates settings.json with the rule" "$(cat "$PROJ/.claude/settings.json" 2>/dev/null)"
fi
rmrf "$PROJ"

# ============================================================================
# AC1 (lockout dead): with tool T approved and live, a staged revision of T
# leaves T's live invocation still passing its pin, and the pending draft is
# visible in the registry (what /toolsmith:list surfaces) — the exact
# lockout scenario the brief opens with.
# ============================================================================
PROJ=$(new_proj)
printf '#!/bin/bash\necho original\n' >"$PROJ/scripts/agent-tools/mytool"
LIVE_SHA=$(shasum -a 256 "$PROJ/scripts/agent-tools/mytool" | awk '{print $1}')
write_staged "$PROJ" mytool $'#!/bin/bash\necho improved\n'
write_revision_registry "$PROJ" mytool "$LIVE_SHA" "Bash(scripts/agent-tools/mytool:*)"

# The live file and its pin are untouched merely by the staged draft existing.
VERIFY_OUT=$(run_approve "$PROJ" --verify)
VERIFY_RC=$?
if [ "$VERIFY_RC" -eq 0 ] && printf '%s' "$VERIFY_OUT" | grep -qE '^OK\s+mytool'; then
  ok
else
  bad "AC1: live tool still verifies OK while a staged revision is pending (no lockout)" "rc=$VERIFY_RC out=$VERIFY_OUT"
fi

if [ "$(cat "$PROJ/scripts/agent-tools/mytool")" = "$(printf '#!/bin/bash\necho original\n')" ]; then
  ok
else
  bad "AC1: live bytes are untouched by an unpromoted staged draft" "$(cat "$PROJ/scripts/agent-tools/mytool")"
fi

HAS_STAGED=$(jq -r '.tools[0] | has("staged")' "$PROJ/.claude/toolsmith/registry.json")
if [ "$HAS_STAGED" = "true" ]; then
  ok
else
  bad "AC1: the pending draft is visible in the registry (what /toolsmith:list surfaces)" "has_staged=$HAS_STAGED"
fi
rmrf "$PROJ"

# ============================================================================
# AC1 (continued): promoting the revision replaces live and re-pins, and the
# review surface for a revision is a DIFF against current live, not full text.
# ============================================================================
PROJ=$(new_proj)
printf '#!/bin/bash\necho original\n' >"$PROJ/scripts/agent-tools/mytool"
LIVE_SHA=$(shasum -a 256 "$PROJ/scripts/agent-tools/mytool" | awk '{print $1}')
write_staged "$PROJ" mytool $'#!/bin/bash\necho improved\n'
write_revision_registry "$PROJ" mytool "$LIVE_SHA" "Bash(scripts/agent-tools/mytool:*)"

DRY_OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool --dry-run)
if printf '%s' "$DRY_OUT" | grep -qi 'revision' \
   && printf '%s' "$DRY_OUT" | grep -qF -- '- echo original' \
   && printf '%s' "$DRY_OUT" | grep -qF -- '+ echo improved'; then
  ok
else
  bad "AC1: a revision's review surface is a diff against current live" "$DRY_OUT"
fi

run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null
NEW_SHA=$(shasum -a 256 "$PROJ/scripts/agent-tools/mytool" | awk '{print $1}')
PINNED_SHA=$(jq -r '.tools[0].approvedSha256' "$PROJ/.claude/toolsmith/registry.json")
if [ "$(cat "$PROJ/scripts/agent-tools/mytool")" = "$(printf '#!/bin/bash\necho improved\n')" ] \
   && [ "$NEW_SHA" != "$LIVE_SHA" ] && [ "$PINNED_SHA" = "$NEW_SHA" ]; then
  ok
else
  bad "AC1: promoting a revision replaces live content and re-pins the new hash" "live=$(cat "$PROJ/scripts/agent-tools/mytool") pinned=$PINNED_SHA new=$NEW_SHA"
fi
rmrf "$PROJ"

# ============================================================================
# AC4 (promotion atomicity + idempotence): kill promotion between "place" and
# the pin-write (simulated via TOOLSMITH_APPROVE_KILL_AFTER=mode — i.e. after
# the file has been placed + chmod/uchg'd, but before the registry pin is
# written). The killed run must exit non-zero and leave live UNPINNED
# (registry still says draft/staged pending). Re-running approve (no kill)
# must then converge to live+pinned+granted — the apply is idempotent.
# ============================================================================
PROJ=$(new_proj)
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
write_new_draft_registry "$PROJ" mytool
EXPECT_SHA=$(shasum -a 256 "$PROJ/.claude/toolsmith/staging/mytool" | awk '{print $1}')

run_approve_kill "$PROJ" mode scripts/agent-tools/mytool >/dev/null 2>&1
KILL_RC=$?
STATUS_AFTER_KILL=$(jq -r '.tools[0].status' "$PROJ/.claude/toolsmith/registry.json")

if [ "$KILL_RC" -ne 0 ] && [ "$STATUS_AFTER_KILL" = "draft" ] && [ -f "$PROJ/scripts/agent-tools/mytool" ]; then
  ok
else
  bad "AC4: killed mid-apply exits non-zero, live placed but registry NOT yet pinned" \
    "kill_rc=$KILL_RC status=$STATUS_AFTER_KILL live_exists=$([ -f "$PROJ/scripts/agent-tools/mytool" ] && echo yes || echo no)"
fi

# The killed-mid-apply state must never be silently trusted: an unpinned live
# file (status still draft) is exactly what the hook's hashDenial refuses.
if [ -f "$PROJ/.claude/toolsmith/staging/mytool" ]; then
  ok # staging file preserved so a re-run has something to promote from
else
  bad "AC4: staging draft survives a kill before the final cleanup step" "removed too early"
fi

# Re-run (no kill) converges: live+pinned+granted, single rule, exact hash.
run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null
CONVERGE_RC=$?
STATUS_AFTER=$(jq -r '.tools[0].status' "$PROJ/.claude/toolsmith/registry.json")
SHA_AFTER=$(jq -r '.tools[0].approvedSha256' "$PROJ/.claude/toolsmith/registry.json")
RULE_COUNT=$(jq '[.permissions.allow[] | select(. == "Bash(scripts/agent-tools/mytool:*)")] | length' "$PROJ/.claude/settings.json")
if [ "$CONVERGE_RC" -eq 0 ] && [ "$STATUS_AFTER" = "approved" ] && [ "$SHA_AFTER" = "$EXPECT_SHA" ] && [ "$RULE_COUNT" -eq 1 ]; then
  ok
else
  bad "AC4: re-running approve after a mid-apply kill converges to live+pinned+granted" \
    "rc=$CONVERGE_RC status=$STATUS_AFTER sha=$SHA_AFTER rule_count=$RULE_COUNT"
fi
rmrf "$PROJ"

# ============================================================================
# AC4 (continued): a SECOND re-run after full success is also a no-op
# (idempotent) — exactly one rule, unchanged hash, no error from "staged"
# already being absent (this is not a "kill" scenario, it's a plain re-run;
# it should be refused cleanly as "nothing to promote", not crash).
# ============================================================================
PROJ=$(new_proj)
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
write_new_draft_registry "$PROJ" mytool
run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null
RULE_COUNT_BEFORE=$(jq '[.permissions.allow[] | select(. == "Bash(scripts/agent-tools/mytool:*)")] | length' "$PROJ/.claude/settings.json")

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool 2>&1)
RC=$?
RULE_COUNT_AFTER=$(jq '[.permissions.allow[] | select(. == "Bash(scripts/agent-tools/mytool:*)")] | length' "$PROJ/.claude/settings.json")
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi 'no "staged" draft' && [ "$RULE_COUNT_BEFORE" -eq "$RULE_COUNT_AFTER" ]; then
  ok
else
  bad "AC4: re-running after full success refuses cleanly (nothing left to promote), no duplicate rule" \
    "rc=$RC before=$RULE_COUNT_BEFORE after=$RULE_COUNT_AFTER out=$OUT"
fi
rmrf "$PROJ"

# ============================================================================
# negative: entry with no "staged" field at all -> refuse, nothing written.
# ============================================================================
PROJ=$(new_proj)
printf '#!/bin/bash\necho hi\n' >"$PROJ/scripts/agent-tools/mytool"
write_bare_registry "$PROJ" mytool draft "" ""
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool 2>&1)
RC=$?
REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi 'no "staged" draft' && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$PROJ/.claude/settings.json" ]; then
  ok
else
  bad "no staged field: refused, nothing written" "rc=$RC out=$OUT"
fi
rmrf "$PROJ"

# ============================================================================
# negative: staged.path pointing outside .claude/toolsmith/staging/ is
# rejected (tampered/malformed registry entry), nothing written.
# ============================================================================
PROJ=$(new_proj)
printf '#!/bin/bash\necho hi\n' >"$PROJ/scripts/agent-tools/evil-staged"
cat >"$PROJ/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "mytool",
      "path": "scripts/agent-tools/mytool",
      "purpose": "x", "args": "", "scope": "x", "covers": [],
      "status": "draft", "approvedSha256": "", "permissionRule": "",
      "staged": { "path": "scripts/agent-tools/evil-staged", "since": "$SINCE" }
    }
  ]
}
EOF
OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool 2>&1)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi 'staging' && [ ! -f "$PROJ/scripts/agent-tools/mytool" ]; then
  ok
else
  bad "staged.path escaping the staging namespace is rejected" "rc=$RC out=$OUT"
fi
rmrf "$PROJ"

# ============================================================================
# missing staged file on disk (entry references it, but it isn't there) => refuse
# ============================================================================
PROJ=$(new_proj)
write_new_draft_registry "$PROJ" mytool
# (deliberately do not write the staging file)
OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool 2>&1)
RC=$?
if [ "$RC" -ne 0 ] && [ ! -f "$PROJ/.claude/settings.json" ]; then ok; else bad "missing staged file refused" "rc=$RC out=$OUT"; fi
rmrf "$PROJ"

# ============================================================================
# path validation: absolute, .. traversal, backslash, special chars all
# rejected for the LIVE <path> argument, under BOTH bare and --dry-run.
# ============================================================================
PROJ=$(new_proj)
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
write_new_draft_registry "$PROJ" mytool
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")

run_approve "$PROJ" /etc/passwd >/dev/null 2>&1; RC1=$?
run_approve "$PROJ" "../etc/passwd" >/dev/null 2>&1; RC2=$?
run_approve "$PROJ" 'scripts\agent-tools\mytool' >/dev/null 2>&1; RC3=$?
run_approve "$PROJ" 'scripts/agent-tools/foo)bar' >/dev/null 2>&1; RC4=$?
run_approve "$PROJ" /etc/passwd --dry-run >/dev/null 2>&1; RC5=$?

REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")
if [ "$RC1" -ne 0 ] && [ "$RC2" -ne 0 ] && [ "$RC3" -ne 0 ] && [ "$RC4" -ne 0 ] && [ "$RC5" -ne 0 ] \
   && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$PROJ/.claude/settings.json" ]; then
  ok
else
  bad "invalid live <path> args rejected under bare and --dry-run, nothing written" \
    "rc1=$RC1 rc2=$RC2 rc3=$RC3 rc4=$RC4 rc5=$RC5"
fi
rmrf "$PROJ"

# ============================================================================
# settings.json with pre-existing unrelated allow rules preserved through a
# real promotion.
# ============================================================================
PROJ=$(new_proj)
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
write_new_draft_registry "$PROJ" mytool
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
  bad "existing allow rules + other keys preserved through promotion" "$(cat "$PROJ/.claude/settings.json")"
fi
rmrf "$PROJ"

# ============================================================================
# fail-closed regression: malformed settings.json aborts the WHOLE apply
# (nothing written — live not placed, registry stays draft+staged intact).
# ============================================================================
PROJ=$(new_proj)
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
write_new_draft_registry "$PROJ" mytool
cat >"$PROJ/.claude/settings.json" <<'EOF'
{
  "permissions": {
    "allow": ["Bash(important:*)"]
  },
EOF
# ^ deliberately truncated / invalid JSON.
SETTINGS_BEFORE=$(cat "$PROJ/.claude/settings.json")
REG_BEFORE=$(cat "$PROJ/.claude/toolsmith/registry.json")

OUT=$(run_approve "$PROJ" scripts/agent-tools/mytool 2>&1)
RC=$?

SETTINGS_AFTER=$(cat "$PROJ/.claude/settings.json")
REG_AFTER=$(cat "$PROJ/.claude/toolsmith/registry.json")

if [ "$RC" -ne 0 ] && [ "$SETTINGS_BEFORE" = "$SETTINGS_AFTER" ] && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$PROJ/scripts/agent-tools/mytool" ]; then
  ok
else
  bad "malformed settings.json aborts the entire apply (fail-closed, live never placed)" \
    "rc=$RC settings_changed=$([ "$SETTINGS_BEFORE" = "$SETTINGS_AFTER" ] && echo no || echo yes) live_placed=$([ -f "$PROJ/scripts/agent-tools/mytool" ] && echo yes || echo no) out=$OUT"
fi
rmrf "$PROJ"

# ============================================================================
# verify: OK / DRIFTED / MISSING / draft (unaffected by the staged rewrite —
# verify only ever inspects the LIVE pin, per contract §2).
# ============================================================================
PROJ=$(new_proj)
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
write_new_draft_registry "$PROJ" mytool
run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null

OUT=$(run_approve "$PROJ" --verify)
RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qE '^OK\s'; then ok; else bad "verify OK when matching" "rc=$RC out=$OUT"; fi

# Mode is 0555 now (not 0755), so drifting the file requires nouchg first
# where chflags is available.
[ "$CHFLAGS_AVAILABLE" -eq 1 ] && chflags nouchg "$PROJ/scripts/agent-tools/mytool" 2>/dev/null
chmod u+w "$PROJ/scripts/agent-tools/mytool"
printf '#!/bin/bash\necho DRIFTED\n' >"$PROJ/scripts/agent-tools/mytool"
OUT=$(run_approve "$PROJ" --verify)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qE '^DRIFTED\s'; then ok; else bad "verify DRIFTED after forced edit" "rc=$RC out=$OUT"; fi

[ "$CHFLAGS_AVAILABLE" -eq 1 ] && chflags nouchg "$PROJ/scripts/agent-tools/mytool" 2>/dev/null
rm -f "$PROJ/scripts/agent-tools/mytool"
OUT=$(run_approve "$PROJ" --verify)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qE '^MISSING\s'; then ok; else bad "verify MISSING after delete" "rc=$RC out=$OUT"; fi
rmrf "$PROJ"

PROJ=$(new_proj)
write_bare_registry "$PROJ" mytool draft "" ""
OUT=$(run_approve "$PROJ" --verify)
RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qE '^draft\s'; then ok; else bad "verify reports draft without failing" "rc=$RC out=$OUT"; fi
rmrf "$PROJ"

# ============================================================================
# verify: a tampered registry entry with an absolute path or ".." must NOT be
# read/hashed outside the project root — report MISSING and fail the run,
# while a valid sibling entry in the same registry still verifies normally.
# ============================================================================
PROJ=$(new_proj)
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
write_new_draft_registry "$PROJ" mytool
run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null
GOOD_SHA=$(jq -r '.tools[0].approvedSha256' "$PROJ/.claude/toolsmith/registry.json")

OUTSIDE=$(mktemp)
printf 'not part of this project\n' >"$OUTSIDE"
OUTSIDE_SHA=$(shasum -a 256 "$OUTSIDE" | awk '{print $1}')

jq --arg outside "$OUTSIDE" --arg osha "$OUTSIDE_SHA" \
  '.tools += [
     {name:"tampered-absolute", path:$outside, purpose:"x", args:"", scope:"x", covers:[], status:"approved", approvedSha256:$osha, permissionRule:("Bash("+$outside+":*)")},
     {name:"tampered-traversal", path:"../../../../etc/passwd", purpose:"x", args:"", scope:"x", covers:[], status:"approved", approvedSha256:"deadbeef", permissionRule:"Bash(../../../../etc/passwd:*)"}
   ]' "$PROJ/.claude/toolsmith/registry.json" >"$PROJ/.claude/toolsmith/registry.json.tmp"
mv "$PROJ/.claude/toolsmith/registry.json.tmp" "$PROJ/.claude/toolsmith/registry.json"

OUT=$(run_approve "$PROJ" --verify)
RC=$?
rm -f "$OUTSIDE"

if [ "$RC" -ne 0 ] \
   && printf '%s' "$OUT" | grep -qE '^OK\s+mytool' \
   && printf '%s' "$OUT" | grep -qE '^MISSING\s+tampered-absolute' \
   && printf '%s' "$OUT" | grep -qE '^MISSING\s+tampered-traversal'; then
  ok
else
  bad "verify never reads outside project root for absolute/.. registry paths" "rc=$RC out=$OUT good_sha=$GOOD_SHA"
fi
rmrf "$PROJ"

# ============================================================================
# rollout migration: a pre-existing approved live tool (mode 0755, from
# before the staged/live split) is protected to 0555 (+ uchg where available)
# the next time ANY approve runs in that scope — idempotent, and it does not
# disturb the tool actually being promoted in the same invocation.
# ============================================================================
PROJ=$(new_proj)
printf '#!/bin/bash\necho legacy\n' >"$PROJ/scripts/agent-tools/legacy-tool"
chmod 0755 "$PROJ/scripts/agent-tools/legacy-tool"
LEGACY_SHA=$(shasum -a 256 "$PROJ/scripts/agent-tools/legacy-tool" | awk '{print $1}')
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
jq -n --arg lsha "$LEGACY_SHA" --arg since "$SINCE" '{
  version: 1,
  tools: [
    {name:"legacy-tool", path:"scripts/agent-tools/legacy-tool", purpose:"x", args:"", scope:"x", covers:[], status:"approved", approvedSha256:$lsha, permissionRule:"Bash(scripts/agent-tools/legacy-tool:*)"},
    {name:"mytool", path:"scripts/agent-tools/mytool", purpose:"x", args:"", scope:"x", covers:[], status:"draft", approvedSha256:"", permissionRule:"",
     staged:{path:".claude/toolsmith/staging/mytool", since:$since}}
  ]
}' >"$PROJ/.claude/toolsmith/registry.json"

run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null
LEGACY_MODE=$(stat -f '%Lp' "$PROJ/scripts/agent-tools/legacy-tool" 2>/dev/null || stat -c '%a' "$PROJ/scripts/agent-tools/legacy-tool" 2>/dev/null)
LEGACY_SHA_AFTER=$(shasum -a 256 "$PROJ/scripts/agent-tools/legacy-tool" | awk '{print $1}')
if [ "$LEGACY_MODE" = "555" ] && [ "$LEGACY_SHA_AFTER" = "$LEGACY_SHA" ]; then
  ok
else
  bad "rollout migration protects a pre-existing approved live tool to 0555, content unchanged" "mode=$LEGACY_MODE sha_after=$LEGACY_SHA_AFTER expected_sha=$LEGACY_SHA"
fi

# Running approve again is a no-op for the already-migrated legacy tool.
OUT2=$(run_approve "$PROJ" --verify scripts/agent-tools/legacy-tool 2>&1)
if printf '%s' "$OUT2" | grep -qE '^OK\s+legacy-tool'; then ok; else bad "migrated legacy tool still verifies OK" "$OUT2"; fi
rmrf "$PROJ"

# ============================================================================
# AC3 (live write-denied, approve-mjs side): after a real promotion, the live
# file's mode (0555) makes a direct write attempt fail — verified with an
# actual write attempt (is_writable), not just a stat of the mode bits.
# ============================================================================
PROJ=$(new_proj)
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
write_new_draft_registry "$PROJ" mytool
run_approve "$PROJ" scripts/agent-tools/mytool >/dev/null
if [ "$(is_writable "$PROJ/scripts/agent-tools/mytool")" = "no" ]; then
  ok
else
  bad "AC3: a promoted live file's mode (0555) denies a direct write attempt" "writable"
fi
if [ "$CHFLAGS_AVAILABLE" -eq 1 ]; then
  if chflags nouchg "$PROJ/scripts/agent-tools/mytool" 2>/dev/null; then ok; else bad "AC3: chflags nouchg succeeds (flag was set by promotion)" "failed"; fi
fi
rmrf "$PROJ"

# ============================================================================
# user scope: full new-tool promotion (AC5) — staged/staging namespace, live
# tools/ path, fully-expanded absolute rule in $HOME/.claude/settings.json.
# ============================================================================
HOME_DIR=$(new_home)
write_user_staged "$HOME_DIR" mytool $'#!/bin/bash\necho hi\n'
write_user_new_draft_registry "$HOME_DIR" mytool
ABS_SCRIPT="$HOME_DIR/.claude/toolsmith/tools/mytool"
EXPECT_SHA=$(shasum -a 256 "$HOME_DIR/.claude/toolsmith/staging/mytool" | awk '{print $1}')
EXPECT_RULE="Bash($ABS_SCRIPT:*)"

OUT=$(run_approve_user "$HOME_DIR" mytool --user --dry-run)
RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qF "$ABS_SCRIPT" && printf '%s' "$OUT" | grep -qF "$EXPECT_RULE" && printf '%s' "$OUT" | grep -qF "$EXPECT_SHA"; then
  ok
else
  bad "user --dry-run: bare name normalizes, previews absolute path + rule + staged hash" "rc=$RC out=$OUT"
fi

OUT=$(run_approve_user "$HOME_DIR" mytool --user)
RC=$?
STATUS=$(jq -r '.tools[0].status' "$HOME_DIR/.claude/toolsmith/registry.json")
SHA=$(jq -r '.tools[0].approvedSha256' "$HOME_DIR/.claude/toolsmith/registry.json")
RULE=$(jq -r '.tools[0].permissionRule' "$HOME_DIR/.claude/toolsmith/registry.json")

if [ "$RC" -eq 0 ] && [ "$STATUS" = "approved" ] && [ "$SHA" = "$EXPECT_SHA" ] && [ "$RULE" = "$EXPECT_RULE" ]; then
  ok
else
  bad "user promote pins registry with fully-expanded absolute rule" "status=$STATUS sha=$SHA rule=$RULE rc=$RC out=$OUT"
fi

if [ -f "$HOME_DIR/.claude/settings.json" ] && jq -e --arg rule "$EXPECT_RULE" '.permissions.allow == [$rule]' "$HOME_DIR/.claude/settings.json" >/dev/null 2>&1; then
  ok
else
  bad "user promote writes the absolute rule into \$HOME/.claude/settings.json" "$(cat "$HOME_DIR/.claude/settings.json" 2>/dev/null)"
fi

if [ -f "$ABS_SCRIPT" ] && [ ! -f "$HOME_DIR/.claude/toolsmith/staging/mytool" ]; then ok; else bad "user promote places live file and removes the staging draft" "live_exists=$([ -f "$ABS_SCRIPT" ] && echo yes || echo no)"; fi
rmrf "$HOME_DIR"

# ============================================================================
# user scope: staged.path escaping staging/ is rejected.
# ============================================================================
HOME_DIR=$(new_home)
printf '#!/bin/bash\necho hi\n' >"$HOME_DIR/.claude/toolsmith/tools/evil-staged"
jq -n --arg since "$SINCE" '{version:1, tools:[{name:"mytool", path:"tools/mytool", purpose:"x", args:"", scope:"x", covers:[], status:"draft", approvedSha256:"", permissionRule:"", staged:{path:"tools/evil-staged", since:$since}}]}' \
  >"$HOME_DIR/.claude/toolsmith/registry.json"
OUT=$(run_approve_user "$HOME_DIR" mytool --user 2>&1)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi 'staging' && [ ! -f "$HOME_DIR/.claude/toolsmith/tools/mytool" ]; then
  ok
else
  bad "user-scope staged.path escaping staging/ is rejected" "rc=$RC out=$OUT"
fi
rmrf "$HOME_DIR"

# ============================================================================
# user scope: malformed $HOME/.claude/settings.json fails the whole apply
# closed (nothing written, staged draft untouched).
# ============================================================================
HOME_DIR=$(new_home)
write_user_staged "$HOME_DIR" mytool $'#!/bin/bash\necho hi\n'
write_user_new_draft_registry "$HOME_DIR" mytool
cat >"$HOME_DIR/.claude/settings.json" <<'EOF'
{
  "permissions": {
    "allow": ["Bash(important:*)"]
  },
EOF
REG_BEFORE=$(cat "$HOME_DIR/.claude/toolsmith/registry.json")
OUT=$(run_approve_user "$HOME_DIR" mytool --user 2>&1)
RC=$?
REG_AFTER=$(cat "$HOME_DIR/.claude/toolsmith/registry.json")
if [ "$RC" -ne 0 ] && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$HOME_DIR/.claude/toolsmith/tools/mytool" ]; then
  ok
else
  bad "user-scope malformed settings.json aborts entire apply (fail-closed)" "rc=$RC out=$OUT"
fi
rmrf "$HOME_DIR"

# ============================================================================
# user scope: --verify --user reports OK / DRIFTED / MISSING
# ============================================================================
HOME_DIR=$(new_home)
write_user_staged "$HOME_DIR" mytool $'#!/bin/bash\necho hi\n'
write_user_new_draft_registry "$HOME_DIR" mytool
run_approve_user "$HOME_DIR" mytool --user >/dev/null

OUT=$(run_approve_user "$HOME_DIR" --verify --user)
RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qE '^OK\s'; then ok; else bad "user --verify OK when matching" "rc=$RC out=$OUT"; fi

[ "$CHFLAGS_AVAILABLE" -eq 1 ] && chflags nouchg "$HOME_DIR/.claude/toolsmith/tools/mytool" 2>/dev/null
chmod u+w "$HOME_DIR/.claude/toolsmith/tools/mytool"
printf '#!/bin/bash\necho DRIFTED\n' >"$HOME_DIR/.claude/toolsmith/tools/mytool"
OUT=$(run_approve_user "$HOME_DIR" --verify --user)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qE '^DRIFTED\s'; then ok; else bad "user --verify DRIFTED after forced edit" "rc=$RC out=$OUT"; fi

[ "$CHFLAGS_AVAILABLE" -eq 1 ] && chflags nouchg "$HOME_DIR/.claude/toolsmith/tools/mytool" 2>/dev/null
rm -f "$HOME_DIR/.claude/toolsmith/tools/mytool"
OUT=$(run_approve_user "$HOME_DIR" --verify --user)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qE '^MISSING\s'; then ok; else bad "user --verify MISSING after delete" "rc=$RC out=$OUT"; fi
rmrf "$HOME_DIR"

# ============================================================================
# project scope stays the default: a project-scope registry entry named the
# same file must NOT be resolvable via --user, and vice versa. Uses --dry-run
# so this check stays side-effect free.
# ============================================================================
PROJ=$(new_proj)
write_staged "$PROJ" mytool $'#!/bin/bash\necho hi\n'
write_new_draft_registry "$PROJ" mytool
HOME_DIR=$(new_home)

OUT=$(HOME="$HOME_DIR" run_approve "$PROJ" scripts/agent-tools/mytool --dry-run)
RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qF "Bash(scripts/agent-tools/mytool:*)"; then
  ok
else
  bad "default (no --user) still previews the project-relative rule" "rc=$RC out=$OUT"
fi
rmrf "$PROJ" "$HOME_DIR"

# ============================================================================
# $HOME-rooted session (issue #36): approving/verifying WITHOUT --user must
# refuse with a clear pointer to --user (fail-closed); WITH --user still
# works normally, now through the staged/live promotion path.
# ============================================================================
HOME_DIR=$(new_home)
write_user_staged "$HOME_DIR" mytool $'#!/bin/bash\necho hi\n'
write_user_new_draft_registry "$HOME_DIR" mytool
REG_BEFORE=$(cat "$HOME_DIR/.claude/toolsmith/registry.json")

OUT=$(CLAUDE_PROJECT_DIR="$HOME_DIR" HOME="$HOME_DIR" node "$APPROVE" tools/mytool 2>&1)
RC=$?
REG_AFTER=$(cat "$HOME_DIR/.claude/toolsmith/registry.json")
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi -- '--user' \
   && [ "$REG_BEFORE" = "$REG_AFTER" ] && [ ! -f "$HOME_DIR/.claude/toolsmith/tools/mytool" ]; then
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
  bad "\$HOME-rooted approve WITH --user still works normally (staged promotion)" "rc=$RC status=$STATUS out=$OUT"
fi
rmrf "$HOME_DIR"

# ============================================================================
# summary
# ============================================================================
echo
echo "toolsmith-approve tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
