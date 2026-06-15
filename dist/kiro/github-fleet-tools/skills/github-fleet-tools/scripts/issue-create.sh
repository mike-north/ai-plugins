#!/usr/bin/env bash
#
# issue-create.sh — create a new issue from a title + body (+ optional labels).
#
# The bounded WRITE primitive for the PM's "file a pickup-ready issue" step. One
# `gh issue create` with explicit, validated inputs — no arbitrary API surface — so it is
# safe to allowlist and run autonomously. Pass the body via a file/stdin so long,
# multi-line, Markdown bodies don't get mangled by shell quoting.
#
# Usage:
#   issue-create.sh --title <T> (--body <B> | --body-file <PATH|->) [--label <L>]...
#
#   issue-create.sh --title "Spec: rollup pace mode" --body-file ./draft.md \
#       --label "P1" --label "spec"
#   cat draft.md | issue-create.sh --title "…" --body-file -
#
# On success prints the new issue URL.
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

title=""
body=""
have_body=0
labels=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)     title="${2:-}"; shift 2 ;;
    --body)      body="${2:-}"; have_body=1; shift 2 ;;
    --body-file)
      src="${2:-}"; shift 2
      [[ -z "$src" ]] && { echo "--body-file requires a path ('-' for stdin)" >&2; exit 2; }
      if [[ "$src" == "-" ]]; then body="$(cat)"; else body="$(cat "$src")"; fi
      have_body=1 ;;
    --label)     labels+=("${2:-}"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$title" ]]; then
  echo "usage: issue-create.sh --title <T> (--body <B> | --body-file <PATH|->) [--label <L>]..." >&2
  exit 2
fi
if [[ "$have_body" -eq 0 || -z "${body// }" ]]; then
  echo "a non-empty --body or --body-file is required (issues must be self-contained)" >&2
  exit 2
fi

args=(issue create --title "$title" --body "$body")
for l in "${labels[@]}"; do
  args+=(--label "$l")
done

url="$("$GH" "${args[@]}")"
echo "created issue: $url"
