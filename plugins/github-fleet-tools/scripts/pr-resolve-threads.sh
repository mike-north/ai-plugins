#!/usr/bin/env bash
#
# pr-resolve-threads.sh — resolve ALL unresolved review threads on a PR at once.
#
# Batch companion to the single-thread pr-reply-resolve.sh. After you've pushed
# commits that address a round of review feedback (and optionally replied to the
# individual threads), this clears every still-unresolved review thread on the PR
# in one pre-approvable invocation — useful when a "conversation resolution" merge
# gate (mergeStateStatus=BLOCKED) is the only thing left.
#
# It is the bulk WRITE companion to the read-only pr-status.sh and the per-thread
# pr-reply-resolve.sh. Preview first with --dry-run; only resolve once you've
# actually addressed the feedback (resolving an un-addressed thread hides it).
#
# Usage:
#   pr-resolve-threads.sh <PR_NUMBER> [--dry-run]
#
#   pr-resolve-threads.sh 12            # resolve every unresolved thread on PR #12
#   pr-resolve-threads.sh 12 --dry-run  # list what WOULD be resolved, change nothing
#
# Output: one line per unresolved thread —
#   [resolved] / [would resolve]  <author>  <path>:<line>  <snippet>
# plus a final count. Prints "(none — all threads already resolved)" when clean.
#
# Exit codes: 0 success (incl. nothing to do); 1 API error / pagination overflow;
#             2 bad usage.
#
# Env:
#   GH       override the gh binary (e.g. GH=/opt/homebrew/bin/gh to bypass a wrapper)
#   GH_HOST  force a hostname (e.g. GH_HOST=github.com on a corp-wrapped gh)
#
set -euo pipefail

GH="${GH:-gh}"
[[ -n "${GH_HOST:-}" ]] && export GH_HOST

pr="${1:-}"
mode="${2:-}"

if [[ -z "$pr" ]]; then
  echo "usage: pr-resolve-threads.sh <PR_NUMBER> [--dry-run]" >&2
  exit 2
fi
if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
  echo "PR_NUMBER must be numeric (got: $pr)" >&2
  exit 2
fi
dry=0
if [[ -n "$mode" ]]; then
  if [[ "$mode" == "--dry-run" ]]; then
    dry=1
  else
    echo "unknown argument: $mode (only --dry-run is supported)" >&2
    exit 2
  fi
fi

nameWithOwner=$("$GH" repo view --json nameWithOwner --jq .nameWithOwner)
owner="${nameWithOwner%%/*}"
repo="${nameWithOwner##*/}"

# Fetch the first page of review threads (id + isResolved + display metadata).
json=$("$GH" api graphql -f owner="$owner" -f repo="$repo" -F pr="$pr" -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:100) {
        pageInfo { hasNextPage }
        nodes {
          id
          isResolved
          path
          line
          comments(first:1) { nodes { author { login } body } }
        }
      }
    }
  }
}')

hasNext=$(printf '%s' "$json" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')

# TSV of unresolved threads: id <TAB> author <TAB> path:line <TAB> snippet
rows=$(printf '%s' "$json" | jq -r '
  .data.repository.pullRequest.reviewThreads.nodes[]
  | select(.isResolved == false)
  | [ .id,
      (.comments.nodes[0].author.login // "?"),
      ((.path // "?") + ":" + ((.line // "?") | tostring)),
      ((.comments.nodes[0].body // "") | gsub("[\n\r]+"; " ") | .[0:100])
    ] | @tsv')

if [[ -z "$rows" ]]; then
  echo "(none — all threads already resolved on PR #$pr)"
  [[ "$hasNext" == "true" ]] && echo "note: PR has >100 threads; only the first page was checked." >&2
  exit 0
fi

count=0
while IFS=$'\t' read -r tid author loc snippet; do
  [[ -z "$tid" ]] && continue
  if [[ "$dry" == "1" ]]; then
    printf '[would resolve]  %s  %s  %s\n' "$author" "$loc" "$snippet"
  else
    ok=$("$GH" api graphql -f tid="$tid" -f query='
      mutation($tid:ID!) {
        resolveReviewThread(input:{threadId:$tid}) { thread { isResolved } }
      }' --jq '.data.resolveReviewThread.thread.isResolved')
    if [[ "$ok" != "true" ]]; then
      echo "ERROR: resolve mutation did not confirm isResolved=true for thread $tid" >&2
      exit 1
    fi
    printf '[resolved]  %s  %s  %s\n' "$author" "$loc" "$snippet"
  fi
  count=$((count + 1))
done <<< "$rows"

if [[ "$dry" == "1" ]]; then
  echo "would resolve $count thread(s) on PR #$pr (dry run — nothing changed)"
else
  echo "resolved $count thread(s) on PR #$pr"
fi
[[ "$hasNext" == "true" ]] && echo "warning: PR has >100 review threads; only the first 100 were processed. This script does not paginate, so re-running re-processes the SAME first page — resolve the remainder manually or via the GitHub UI." >&2
exit 0
