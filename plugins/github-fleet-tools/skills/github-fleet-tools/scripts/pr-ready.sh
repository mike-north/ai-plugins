#!/usr/bin/env bash
#
# pr-ready.sh — mark a draft PR as ready for review.
#
# The bounded WRITE primitive for an implementer flipping its PR out of draft once the
# checks are green and the description is complete. One `gh pr ready` — no arbitrary API
# surface — so it is safe to allowlist and run autonomously.
#
# Usage:
#   pr-ready.sh <PR_NUMBER>
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
if [[ -z "$num" ]]; then
  echo "usage: pr-ready.sh <PR_NUMBER>" >&2
  exit 2
fi
if ! [[ "$num" =~ ^[0-9]+$ ]]; then
  echo "PR_NUMBER must be numeric (got: $num)" >&2
  exit 2
fi

"$GH" pr ready "$num" >/dev/null
echo "marked PR #$num ready for review"
