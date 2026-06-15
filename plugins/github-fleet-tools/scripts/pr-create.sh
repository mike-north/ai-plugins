#!/usr/bin/env bash
#
# pr-create.sh — open a pull request from an explicit title + body (+ options).
#
# The bounded WRITE primitive for an implementer's "open the PR and stop" step. One
# `gh pr create` with validated inputs — no arbitrary API surface — so it is safe to
# allowlist and run autonomously. Pass the body via a file/stdin so the PR description
# (acceptance-criteria-to-test mapping, etc.) isn't mangled by shell quoting.
#
# Reminder (enforced by convention, not this script): reference the issue with `Refs #N`,
# NOT `Closes #N`, unless the PR truly completes the issue — closing keywords close
# tracking issues out from under the queue.
#
# Usage:
#   pr-create.sh --title <T> (--body <B> | --body-file <PATH|->) \
#       [--base <BRANCH>] [--head <BRANCH>] [--draft] [--reviewer <USER>]...
#
#   pr-create.sh --title "fix(core): …" --body-file ./pr.md --reviewer copilot-pull-request-reviewer
#
# On success prints the new PR URL.
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
base=""
head=""
draft=0
reviewers=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)    title="${2:-}"; shift 2 ;;
    --body)     body="${2:-}"; have_body=1; shift 2 ;;
    --body-file)
      src="${2:-}"; shift 2
      [[ -z "$src" ]] && { echo "--body-file requires a path ('-' for stdin)" >&2; exit 2; }
      if [[ "$src" == "-" ]]; then body="$(cat)"; else body="$(cat "$src")"; fi
      have_body=1 ;;
    --base)     base="${2:-}"; shift 2 ;;
    --head)     head="${2:-}"; shift 2 ;;
    --draft)    draft=1; shift ;;
    --reviewer) reviewers+=("${2:-}"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$title" ]]; then
  echo "usage: pr-create.sh --title <T> (--body <B> | --body-file <PATH|->) [--base B] [--head H] [--draft] [--reviewer U]..." >&2
  exit 2
fi
if [[ "$have_body" -eq 0 || -z "${body// }" ]]; then
  echo "a non-empty --body or --body-file is required" >&2
  exit 2
fi

args=(pr create --title "$title" --body "$body")
[[ -n "$base" ]] && args+=(--base "$base")
[[ -n "$head" ]] && args+=(--head "$head")
[[ "$draft" -eq 1 ]] && args+=(--draft)
for r in "${reviewers[@]}"; do
  args+=(--reviewer "$r")
done

url="$("$GH" "${args[@]}")"
echo "created PR: $url"
