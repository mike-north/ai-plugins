#!/usr/bin/env bash
#
# pr-comment.sh — post a single general (conversation) comment on a PR.
#
# The bounded WRITE primitive for PR-level remarks that aren't review-thread replies
# (those are pr-reply-resolve.sh). One `gh pr comment` — no arbitrary API surface — so it
# is safe to allowlist and run autonomously.
#
# Usage:
#   pr-comment.sh <PR_NUMBER> <BODY>
#   pr-comment.sh <PR_NUMBER> --body-file <PATH>          # body from a file
#   echo "..." | pr-comment.sh <PR_NUMBER> --body-file -  # body from stdin
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
  echo "usage: pr-comment.sh <PR_NUMBER> <BODY | --body-file PATH>" >&2
  exit 2
fi
if ! [[ "$num" =~ ^[0-9]+$ ]]; then
  echo "PR_NUMBER must be numeric (got: $num)" >&2
  exit 2
fi
shift

if [[ "${1:-}" == "--body-file" ]]; then
  src="${2:-}"
  [[ -z "$src" ]] && { echo "--body-file requires a path ('-' for stdin)" >&2; exit 2; }
  if [[ "$src" == "-" ]]; then body="$(cat)"; else body="$(cat "$src")"; fi
else
  body="${1:-}"
fi

if [[ -z "${body// }" ]]; then
  echo "refusing to post an empty comment" >&2
  exit 2
fi

"$GH" pr comment "$num" --body "$body" >/dev/null
echo "commented on PR #$num"
