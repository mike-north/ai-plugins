#!/usr/bin/env bash
#
# pr-reply-resolve.sh — reply to a PR review thread and resolve it, in one command.
#
# Collapses the usual two-step dance — POST a reply, then GraphQL
# resolveReviewThread — into a single, pre-approvable invocation. Given the FIRST
# comment's REST databaseId of a review thread (the `thread_comment_id` that
# pr-status.sh prints), it:
#   1. posts a reply on that thread (skipped when the body is empty/omitted), then
#   2. resolves the thread (idempotent — a no-op if it's already resolved).
#
# This is the WRITE companion to the read-only pr-status.sh: pr-status surfaces the
# unresolved threads + their thread_comment_ids; this acts on one of them.
#
# Usage:
#   pr-reply-resolve.sh <PR_NUMBER> <THREAD_COMMENT_ID> [REPLY_BODY]
#
#   # reply + resolve
#   pr-reply-resolve.sh 94 3414731386 "Fixed in abc1234 — added the guard + a regression test."
#   # resolve only (no reply)
#   pr-reply-resolve.sh 94 3414731386
#
# Exit codes: 0 success (or already resolved); 1 thread not found / API error;
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
cid="${2:-}"
body="${3:-}"

if [[ -z "$pr" || -z "$cid" ]]; then
  echo "usage: pr-reply-resolve.sh <PR_NUMBER> <THREAD_COMMENT_ID> [REPLY_BODY]" >&2
  exit 2
fi
if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
  echo "PR_NUMBER must be numeric (got: $pr)" >&2
  exit 2
fi
if ! [[ "$cid" =~ ^[0-9]+$ ]]; then
  echo "THREAD_COMMENT_ID must be numeric (the first comment's REST databaseId; got: $cid)" >&2
  exit 2
fi

nameWithOwner=$("$GH" repo view --json nameWithOwner --jq .nameWithOwner)
owner="${nameWithOwner%%/*}"
repo="${nameWithOwner##*/}"

# 1. Reply (unless the body is empty/omitted).
if [[ -n "$body" ]]; then
  reply_id=$("$GH" api "repos/$owner/$repo/pulls/$pr/comments/$cid/replies" \
    -f body="$body" --jq '.id')
  echo "replied (new comment id $reply_id) to thread of comment $cid on PR #$pr"
else
  echo "no reply body given — resolve only"
fi

# 2. Find the review-thread node id whose FIRST comment databaseId == $cid.
#    (databaseId is a number; interpolate the validated $cid into the jq filter —
#    GraphQL has no nice way to filter threads by a member comment's databaseId.)
match=$("$GH" api graphql -f owner="$owner" -f repo="$repo" -F pr="$pr" -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:100) {
        pageInfo { hasNextPage }
        nodes { id isResolved comments(first:1) { nodes { databaseId } } }
      }
    }
  }
}' --jq "
  .data.repository.pullRequest.reviewThreads as \$t
  | [\$t.nodes[] | select(.comments.nodes[0].databaseId == $cid)] as \$m
  | if (\$m | length) > 0
    then \"\(\$m[0].id) \(\$m[0].isResolved)\"
    else (if \$t.pageInfo.hasNextPage then \"__OVERFLOW__\" else \"\" end)
    end")

if [[ "$match" == "__OVERFLOW__" ]]; then
  echo "ERROR: comment $cid not in the first 100 review threads on PR #$pr (pagination needed)." >&2
  exit 1
fi
if [[ -z "$match" ]]; then
  echo "ERROR: no review thread found whose first comment databaseId is $cid on PR #$pr." >&2
  exit 1
fi

thread_id="${match%% *}"
resolved="${match##* }"

if [[ "$resolved" == "true" ]]; then
  echo "thread (comment $cid) already resolved — nothing to do"
  exit 0
fi

now_resolved=$("$GH" api graphql -f tid="$thread_id" -f query='
mutation($tid:ID!) {
  resolveReviewThread(input:{threadId:$tid}) { thread { isResolved } }
}' --jq '.data.resolveReviewThread.thread.isResolved')

if [[ "$now_resolved" == "true" ]]; then
  echo "resolved thread (comment $cid, node $thread_id) on PR #$pr"
else
  echo "ERROR: resolve mutation did not confirm isResolved=true for thread $thread_id" >&2
  exit 1
fi
