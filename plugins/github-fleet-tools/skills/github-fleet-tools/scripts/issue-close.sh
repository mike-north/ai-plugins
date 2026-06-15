#!/usr/bin/env bash
#
# issue-close.sh — close an issue, optionally with a closing comment.
#
# The bounded WRITE primitive for the orchestrator's "criteria met → close" step. Because
# fleet PRs reference issues with `Refs #N` (not `Closes #N`), a merge does NOT auto-close
# the tracking issue — the orchestrator closes it explicitly once the acceptance criteria
# are demonstrably met. One `gh issue close` (+ optional comment) — no arbitrary API.
#
# Usage:
#   issue-close.sh <ISSUE_NUMBER> [COMMENT]
#   issue-close.sh <ISSUE_NUMBER> --body-file <PATH>       # closing comment from a file
#   echo "..." | issue-close.sh <ISSUE_NUMBER> --body-file -   # from stdin
#
#   issue-close.sh 142 "Criteria 1–3 covered by tests X/Y/Z; merged in #150."
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
  echo "usage: issue-close.sh <ISSUE_NUMBER> [COMMENT | --body-file PATH]" >&2
  exit 2
fi
if ! [[ "$num" =~ ^[0-9]+$ ]]; then
  echo "ISSUE_NUMBER must be numeric (got: $num)" >&2
  exit 2
fi
shift

comment=""
if [[ "${1:-}" == "--body-file" ]]; then
  src="${2:-}"
  [[ -z "$src" ]] && { echo "--body-file requires a path ('-' for stdin)" >&2; exit 2; }
  if [[ "$src" == "-" ]]; then comment="$(cat)"; else comment="$(cat "$src")"; fi
elif [[ -n "${1:-}" ]]; then
  comment="$1"
fi

if [[ -n "${comment// }" ]]; then
  "$GH" issue close "$num" --comment "$comment" >/dev/null
  echo "closed #$num (with comment)"
else
  "$GH" issue close "$num" >/dev/null
  echo "closed #$num"
fi
