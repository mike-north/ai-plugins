#!/usr/bin/env bash
#
# pr-merge.sh — squash-merge a PR, but ONLY when it is genuinely safe to.
#
# This is the highest-consequence write in the fleet, so it is deliberately NOT on the
# autonomous allowlist — it prompts every time (grant it to the PM/orchestrator context
# only). The guards below are defense-in-depth: even an approved invocation REFUSES to
# merge unless all of the following hold, so a misfire can't ship a bad merge:
#
#   1. The PR is OPEN and not a draft.
#   2. It is NOT a release/Version PR (those are a human's deliberate release gate).
#   3. A Copilot review is present (and its latest verdict is not "changes requested").
#   4. Required status checks have passed (`gh pr checks --required` exits clean).
#
# It always merges with --squash and never deletes the branch (avoids breaking stacked PRs).
# Use --dry-run to evaluate the guards and print the verdict without merging.
#
# Usage:
#   pr-merge.sh <PR_NUMBER> [--dry-run]
#
# Exit codes: 0 merged (or --dry-run: would merge); 1 gh/API error;
#             2 bad usage; 3 a guard refused the merge.
#
# Env:
#   GH                     override the gh binary (e.g. GH=gh_dotcom)
#   GH_HOST                force a hostname (e.g. GH_HOST=github.com)
#   PLEF_COPILOT_LOGIN_RE  regex matched against review author logins (default "copilot")
#   PLEF_VERSION_TITLE_RE  title regex marking a release PR  (default "^Release packages")
#   PLEF_VERSION_BRANCH_RE head-branch regex marking a release PR (default "^changeset-release/")
#
set -euo pipefail

GH="${GH:-gh}"
[[ -n "${GH_HOST:-}" ]] && export GH_HOST
COPILOT_RE="${PLEF_COPILOT_LOGIN_RE:-copilot}"
VERSION_TITLE_RE="${PLEF_VERSION_TITLE_RE:-^Release packages}"
VERSION_BRANCH_RE="${PLEF_VERSION_BRANCH_RE:-^changeset-release/}"

num="${1:-}"
mode="${2:-}"
dry=0

if [[ -z "$num" ]]; then
  echo "usage: pr-merge.sh <PR_NUMBER> [--dry-run]" >&2
  exit 2
fi
if ! [[ "$num" =~ ^[0-9]+$ ]]; then
  echo "PR_NUMBER must be numeric (got: $num)" >&2
  exit 2
fi
if [[ -n "$mode" ]]; then
  if [[ "$mode" == "--dry-run" ]]; then dry=1; else echo "unknown argument: $mode" >&2; exit 2; fi
fi

refuse() { echo "REFUSING to merge PR #$num: $1" >&2; exit 3; }

meta="$("$GH" pr view "$num" --json number,title,state,isDraft,headRefName,reviews)"

state=$(printf '%s' "$meta" | jq -r '.state')
isDraft=$(printf '%s' "$meta" | jq -r '.isDraft')
title=$(printf '%s' "$meta" | jq -r '.title')
head=$(printf '%s' "$meta" | jq -r '.headRefName')

# Guard 1: open, not draft.
[[ "$state" == "OPEN" ]] || refuse "state is $state, not OPEN"
[[ "$isDraft" == "false" ]] || refuse "it is still a draft"

# Guard 2: not a release/Version PR.
if printf '%s' "$title" | grep -qiE "$VERSION_TITLE_RE" || printf '%s' "$head" | grep -qiE "$VERSION_BRANCH_RE"; then
  refuse "this looks like a release/Version PR (\"$title\" on $head) — those are a human's release gate"
fi

# Guard 3: a Copilot review is present, and its latest verdict isn't CHANGES_REQUESTED.
copilot_latest=$(printf '%s' "$meta" | jq -r --arg re "$COPILOT_RE" '
  [ .reviews[] | select(.author.login | test($re; "i")) ]
  | sort_by(.submittedAt) | last | .state // "NONE"')
[[ "$copilot_latest" != "NONE" ]] || refuse "no Copilot review present (looked for author login matching /$COPILOT_RE/i)"
[[ "$copilot_latest" != "CHANGES_REQUESTED" ]] || refuse "the latest Copilot review requests changes"

# Guard 4: required status checks have passed.
if ! "$GH" pr checks "$num" --required >/dev/null 2>&1; then
  refuse "required status checks have not all passed (gh pr checks --required is not clean; if the repo has no required checks, merge manually)"
fi

if [[ "$dry" == "1" ]]; then
  echo "would merge PR #$num (squash): all guards pass — open, non-draft, not a release PR, Copilot review present ($copilot_latest), required checks green"
  exit 0
fi

"$GH" pr merge "$num" --squash
echo "squash-merged PR #$num"
