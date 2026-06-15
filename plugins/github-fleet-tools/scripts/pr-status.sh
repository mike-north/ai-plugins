#!/usr/bin/env bash
#
# pr-status.sh — deterministic, READ-ONLY pull-request health report.
#
# Bundles three things into a single command so they need approving once,
# instead of a stream of ad-hoc `gh api graphql` / `gh pr view` invocations:
#   1. CI check rollup        (gh pr checks)
#   2. Merge state            (state / draft / mergeable / mergeStateStatus / reviewDecision)
#   3. UNRESOLVED review threads, each with the first comment's databaseId so
#      you can reply (`gh api .../pulls/N/comments/<id>/replies`) and resolve
#      (GraphQL resolveReviewThread) it afterward.
#
# Usage:
#   pr-status.sh [PR_NUMBER]      # defaults to the current branch's PR
#
# Env:
#   GH       override the gh binary (e.g. GH=/opt/homebrew/bin/gh to bypass a wrapper)
#   GH_HOST  force a hostname (e.g. GH_HOST=github.com on a corp-wrapped gh)
#
set -euo pipefail

GH="${GH:-gh}"

nameWithOwner=$("$GH" repo view --json nameWithOwner --jq .nameWithOwner)
owner="${nameWithOwner%%/*}"
repo="${nameWithOwner##*/}"

pr="${1:-}"
if [[ -z "$pr" ]]; then
  pr=$("$GH" pr view --json number --jq .number 2>/dev/null || true)
  if [[ -z "$pr" ]]; then
    echo "No PR number given and no PR found for the current branch." >&2
    exit 1
  fi
fi

echo "=== PR #$pr ($owner/$repo) ==="
echo

echo "--- Checks ---"
# gh pr checks exits non-zero when any check is pending/failing; keep going.
"$GH" pr checks "$pr" 2>/dev/null || true
echo

echo "--- Merge state ---"
"$GH" pr view "$pr" --json state,isDraft,mergeable,mergeStateStatus,reviewDecision \
  --jq '"state=\(.state)  draft=\(.isDraft)  mergeable=\(.mergeable)  mergeStateStatus=\(.mergeStateStatus)  reviewDecision=\(.reviewDecision // "none")"'
echo

echo "--- Unresolved review threads ---"
"$GH" api graphql -f owner="$owner" -f repo="$repo" -F pr="$pr" -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first:1) { nodes { databaseId author { login } body } }
        }
      }
    }
  }
}' --jq '
  .data.repository.pullRequest.reviewThreads.nodes
  | map(select(.isResolved == false))
  | if length == 0 then "  (none — all threads resolved)"
    else (.[] | "  • [\(.comments.nodes[0].author.login)] \(.path):\(.line // "?")\(if .isOutdated then " (outdated)" else "" end)  thread_comment_id=\(.comments.nodes[0].databaseId)\n      \(.comments.nodes[0].body | gsub("[\n\r]+"; " ") | .[0:140])")
    end
'
echo
echo "=== END PR #$pr ==="
