#!/usr/bin/env bash
# diff-stats.sh - Deterministic diff statistics between two git refs
#
# Usage:
#   diff-stats.sh <base-ref> <head-ref>
#   diff-stats.sh <base-ref>              # head defaults to HEAD
#   diff-stats.sh                          # auto-detects merge-base of HEAD vs main/master
#
# Output: Exact line counts with breakdowns:
#   - Raw totals (all files)
#   - Meaningful totals (excluding linguist-generated files)
#   - Test file breakdown (files with "test" in the path)
#
# Honors .gitattributes linguist-generated markers.

set -euo pipefail

# Determine refs
if [[ $# -ge 2 ]]; then
  BASE="$1"
  HEAD="$2"
elif [[ $# -eq 1 ]]; then
  BASE="$1"
  HEAD="HEAD"
else
  BASE=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo "HEAD~1")
  HEAD="HEAD"
fi

# Verify refs exist
if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  echo "ERROR: Invalid base ref: $BASE" >&2
  exit 1
fi
if ! git rev-parse --verify "$HEAD" >/dev/null 2>&1; then
  echo "ERROR: Invalid head ref: $HEAD" >&2
  exit 1
fi

BASE_SHORT=$(git rev-parse --short "$BASE" 2>/dev/null || echo "$BASE")
HEAD_SHORT=$(git rev-parse --short "$HEAD" 2>/dev/null || echo "$HEAD")

# Collect generated file patterns from .gitattributes
# Matches lines like: docs/** linguist-generated=true
# or: *.generated.ts linguist-generated
GENERATED_PATTERNS=()
if [[ -f ".gitattributes" ]]; then
  while IFS= read -r line; do
    # Extract the glob pattern from lines containing linguist-generated
    pattern=$(echo "$line" | grep -i 'linguist-generated' | awk '{print $1}' 2>/dev/null || true)
    if [[ -n "$pattern" ]]; then
      GENERATED_PATTERNS+=("$pattern")
    fi
  done < .gitattributes
fi

# Get per-file numstat (additions, deletions, filename)
# Format: <added>\t<deleted>\t<filename>
# Binary files show as: -\t-\t<filename>
NUMSTAT=$(git diff --numstat "$BASE..$HEAD" 2>/dev/null || true)

if [[ -z "$NUMSTAT" ]]; then
  echo "=== DIFF STATS: $BASE_SHORT..$HEAD_SHORT ==="
  echo "No changes detected between $BASE_SHORT and $HEAD_SHORT"
  exit 0
fi

# Categorize each file
RAW_ADDED=0
RAW_DELETED=0
RAW_FILES=0
MEANINGFUL_ADDED=0
MEANINGFUL_DELETED=0
MEANINGFUL_FILES=0
TEST_ADDED=0
TEST_DELETED=0
TEST_FILES=0
GENERATED_ADDED=0
GENERATED_DELETED=0
GENERATED_FILES=0
BINARY_FILES=0

is_generated() {
  local filepath="$1"
  # git's own attribute lookup is authoritative — one check-attr per file.
  # (GENERATED_PATTERNS is only the cheap "any patterns declared?" gate at the call site.)
  local attr
  attr=$(git check-attr linguist-generated -- "$filepath" 2>/dev/null || true)
  echo "$attr" | grep -q ': true$\|: set$'
}

is_test() {
  local filepath="$1"
  # Case-insensitive check for "test" anywhere in the path
  echo "$filepath" | grep -qi 'test'
}

while IFS=$'\t' read -r added deleted filepath; do
  # Skip empty lines
  [[ -z "$filepath" ]] && continue

  # Handle binary files
  if [[ "$added" == "-" ]] || [[ "$deleted" == "-" ]]; then
    BINARY_FILES=$((BINARY_FILES + 1))
    RAW_FILES=$((RAW_FILES + 1))
    continue
  fi

  RAW_ADDED=$((RAW_ADDED + added))
  RAW_DELETED=$((RAW_DELETED + deleted))
  RAW_FILES=$((RAW_FILES + 1))

  # Check if generated
  local_generated=false
  if [[ ${#GENERATED_PATTERNS[@]} -gt 0 ]] && is_generated "$filepath"; then
    GENERATED_ADDED=$((GENERATED_ADDED + added))
    GENERATED_DELETED=$((GENERATED_DELETED + deleted))
    GENERATED_FILES=$((GENERATED_FILES + 1))
    local_generated=true
  fi

  # Meaningful = not generated
  if [[ "$local_generated" == "false" ]]; then
    MEANINGFUL_ADDED=$((MEANINGFUL_ADDED + added))
    MEANINGFUL_DELETED=$((MEANINGFUL_DELETED + deleted))
    MEANINGFUL_FILES=$((MEANINGFUL_FILES + 1))

    # Test breakdown (only within meaningful files)
    if is_test "$filepath"; then
      TEST_ADDED=$((TEST_ADDED + added))
      TEST_DELETED=$((TEST_DELETED + deleted))
      TEST_FILES=$((TEST_FILES + 1))
    fi
  fi
done <<< "$NUMSTAT"

NON_TEST_ADDED=$((MEANINGFUL_ADDED - TEST_ADDED))
NON_TEST_DELETED=$((MEANINGFUL_DELETED - TEST_DELETED))
NON_TEST_FILES=$((MEANINGFUL_FILES - TEST_FILES))

# Output
echo "=== DIFF STATS: $BASE_SHORT..$HEAD_SHORT ==="
echo ""
echo "RAW TOTALS (all files):"
echo "  Files changed: $RAW_FILES"
echo "  Lines added:   +$RAW_ADDED"
echo "  Lines removed: -$RAW_DELETED"
echo "  Net change:    $((RAW_ADDED - RAW_DELETED))"
if [[ $BINARY_FILES -gt 0 ]]; then
  echo "  Binary files:  $BINARY_FILES"
fi

if [[ $GENERATED_FILES -gt 0 ]]; then
  echo ""
  echo "GENERATED FILES (linguist-generated, excluded from meaningful count):"
  echo "  Files: $GENERATED_FILES"
  echo "  Lines added:   +$GENERATED_ADDED"
  echo "  Lines removed: -$GENERATED_DELETED"
fi

echo ""
echo "MEANINGFUL TOTALS (excluding generated files):"
echo "  Files changed: $MEANINGFUL_FILES"
echo "  Lines added:   +$MEANINGFUL_ADDED"
echo "  Lines removed: -$MEANINGFUL_DELETED"
echo "  Net change:    $((MEANINGFUL_ADDED - MEANINGFUL_DELETED))"

echo ""
echo "BREAKDOWN — Implementation:"
echo "  Files: $NON_TEST_FILES"
echo "  Lines added:   +$NON_TEST_ADDED"
echo "  Lines removed: -$NON_TEST_DELETED"

echo ""
echo "BREAKDOWN — Tests (path contains 'test'):"
echo "  Files: $TEST_FILES"
echo "  Lines added:   +$TEST_ADDED"
echo "  Lines removed: -$TEST_DELETED"

echo ""
echo "=== END DIFF STATS ==="
