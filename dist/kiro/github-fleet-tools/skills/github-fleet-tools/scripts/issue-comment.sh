#!/usr/bin/env bash
#
# issue-comment.sh — post a single comment on an issue.
#
# The bounded WRITE primitive for the fleet's coordination comments: intent on claim,
# blocked/descope notes, the criteria-met summary at close. One `gh issue comment` — no
# arbitrary API surface — so it is safe to allowlist and run autonomously.
#
# Usage:
#   issue-comment.sh <ISSUE_NUMBER> <BODY>
#   issue-comment.sh <ISSUE_NUMBER> --body-file <PATH>     # read body from a file
#   echo "..." | issue-comment.sh <ISSUE_NUMBER> --body-file -   # body from stdin
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
  echo "usage: issue-comment.sh <ISSUE_NUMBER> <BODY | --body-file PATH>" >&2
  exit 2
fi
if ! [[ "$num" =~ ^[0-9]+$ ]]; then
  echo "ISSUE_NUMBER must be numeric (got: $num)" >&2
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

"$GH" issue comment "$num" --body "$body" >/dev/null
echo "commented on #$num"
