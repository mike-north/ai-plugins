#!/usr/bin/env bash
#
# issue-label.sh — add or remove a single label on an issue (or PR).
#
# The bounded WRITE primitive behind "claim" / "release" in the product-led-eng-fleet
# loop: claim = `issue-label.sh <N> add "in progress"`, release = `… remove …`. It does
# exactly one label mutation via `gh issue edit` — no arbitrary API surface — so it is
# safe to allowlist and run autonomously.
#
# Usage:
#   issue-label.sh <ISSUE_NUMBER> <add|remove> <LABEL>
#
#   issue-label.sh 142 add "in progress"
#   issue-label.sh 142 remove "in progress"
#
# Exit codes: 0 success; 1 gh/API error; 2 bad usage.
#
# Env:
#   GH       override the gh binary (e.g. GH=gh_dotcom)
#   GH_HOST  force a hostname (e.g. GH_HOST=github.com)
#
set -euo pipefail

GH="${GH:-gh}"
[[ -n "${GH_HOST:-}" ]] && export GH_HOST

num="${1:-}"
op="${2:-}"
label="${3:-}"

if [[ -z "$num" || -z "$op" || -z "$label" ]]; then
  echo "usage: issue-label.sh <ISSUE_NUMBER> <add|remove> <LABEL>" >&2
  exit 2
fi
if ! [[ "$num" =~ ^[0-9]+$ ]]; then
  echo "ISSUE_NUMBER must be numeric (got: $num)" >&2
  exit 2
fi

case "$op" in
  add)    "$GH" issue edit "$num" --add-label "$label"    >/dev/null; echo "added label \"$label\" to #$num" ;;
  remove) "$GH" issue edit "$num" --remove-label "$label" >/dev/null; echo "removed label \"$label\" from #$num" ;;
  *) echo "operation must be 'add' or 'remove' (got: $op)" >&2; exit 2 ;;
esac
