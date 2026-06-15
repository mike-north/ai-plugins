#!/usr/bin/env bash
#
# pr-thread-status.sh — per-thread resolution + reply status for a PR's review threads.
#
# Read-only triage companion to pr-reply-resolve.sh / pr-resolve-threads.sh. A CI/PR
# monitor often replays inline review comments by their first-comment databaseId and asks
# you to "reply + resolve" — but some are already handled. This script answers, per thread,
# whether it is RESOLVED and whether it already has a reply, so a loop can act ONLY on the
# threads that still need action (and never double-reply).
#
# Usage:
#   pr-thread-status.sh <PR_NUMBER> [COMMENT_ID ...] [--json]
#
#   pr-thread-status.sh 10                       # every review thread + status
#   pr-thread-status.sh 10 3415626332 3415626397 # only those threads (by first-comment id)
#   pr-thread-status.sh 10 --json                # machine-readable
#
# Output (per thread): the first comment's databaseId (the `thread_comment_id` that
# pr-status.sh prints and pr-reply-resolve.sh consumes), resolved state, reply count,
# author, and path:line.
#
# Exit codes:
#   0  all queried threads are RESOLVED (nothing needs action) — or, with no ids, listing succeeded
#   2  at least one queried COMMENT_ID maps to an UNRESOLVED thread (needs action), OR
#      a given COMMENT_ID matched no thread on this PR; bad usage
#   1  gh/API error / pagination overflow
#
# Env:
#   GH       override the gh binary (e.g. GH=gh_dotcom)
#   GH_HOST  force a hostname (e.g. GH_HOST=github.com)
#
set -euo pipefail

GH="${GH:-gh}"
[[ -n "${GH_HOST:-}" ]] && export GH_HOST

pr=""
json=0
ids=()
for arg in "$@"; do
  case "$arg" in
    --json) json=1 ;;
    -*) echo "unknown argument: $arg" >&2; exit 2 ;;
    *)
      if [[ -z "$pr" ]]; then pr="$arg"; else ids+=("$arg"); fi ;;
  esac
done

if [[ -z "$pr" ]]; then
  echo "usage: pr-thread-status.sh <PR_NUMBER> [COMMENT_ID ...] [--json]" >&2
  exit 2
fi
if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
  echo "PR_NUMBER must be numeric (got: $pr)" >&2
  exit 2
fi
for id in "${ids[@]}"; do
  [[ "$id" =~ ^[0-9]+$ ]] || { echo "COMMENT_ID must be numeric (got: $id)" >&2; exit 2; }
done

nameWithOwner=$("$GH" repo view --json nameWithOwner --jq .nameWithOwner)
owner="${nameWithOwner%%/*}"
repo="${nameWithOwner##*/}"

raw=$("$GH" api graphql -f owner="$owner" -f repo="$repo" -F pr="$pr" -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:100) {
        pageInfo { hasNextPage }
        nodes {
          isResolved
          path
          line
          comments(first:100) {
            totalCount
            nodes { databaseId author { login } body }
          }
        }
      }
    }
  }
}')

hasNext=$(printf '%s' "$raw" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')

# Normalize each thread → JSON object: firstId, resolved, replies, author, loc, snippet.
threads=$(printf '%s' "$raw" | jq -c '
  .data.repository.pullRequest.reviewThreads.nodes[]
  | {
      firstId:   (.comments.nodes[0].databaseId),
      resolved:  .isResolved,
      replies:   ((.comments.totalCount // 1) - 1),
      author:    (.comments.nodes[0].author.login // "?"),
      loc:       ((.path // "?") + ":" + ((.line // "?") | tostring)),
      snippet:   ((.comments.nodes[0].body // "") | gsub("[\n\r]+"; " ") | .[0:80])
    }')

# Optionally filter to the requested comment ids, preserving "not found" detection.
selected="$threads"
missing=()
if [[ ${#ids[@]} -gt 0 ]]; then
  idset=$(printf '%s\n' "${ids[@]}" | jq -R 'tonumber' | jq -s '.')
  selected=$(printf '%s' "$threads" | jq -c --argjson ids "$idset" 'select(.firstId as $f | $ids | index($f))')
  for id in "${ids[@]}"; do
    if ! printf '%s' "$threads" | jq -e --argjson id "$id" 'select(.firstId == $id)' >/dev/null; then
      missing+=("$id")
    fi
  done
fi

if [[ "$json" == "1" ]]; then
  printf '%s' "$selected" | jq -s --argjson missing "$(printf '%s\n' "${missing[@]:-}" | jq -R 'select(length>0)|tonumber' | jq -s '.')" \
    '{threads: ., missing: $missing}'
else
  if [[ -z "$selected" ]]; then
    echo "(no matching review threads on PR #$pr)"
  fi
  printf '%s\n' "$selected" | while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    fid=$(printf '%s' "$t" | jq -r '.firstId')
    res=$(printf '%s' "$t" | jq -r 'if .resolved then "RESOLVED" else "UNRESOLVED" end')
    rep=$(printf '%s' "$t" | jq -r '.replies')
    auth=$(printf '%s' "$t" | jq -r '.author')
    loc=$(printf '%s' "$t" | jq -r '.loc')
    snip=$(printf '%s' "$t" | jq -r '.snippet')
    printf 'thread_comment_id=%s  %-10s  replies=%s  %s  %s  %s\n' "$fid" "$res" "$rep" "$auth" "$loc" "$snip"
  done
  for id in "${missing[@]:-}"; do
    [[ -z "$id" ]] && continue
    echo "thread_comment_id=$id  NOT-FOUND   (no review thread on PR #$pr has this first-comment id)"
  done
  [[ "$hasNext" == "true" ]] && echo "note: PR has >100 review threads; only the first page was checked." >&2
fi

# Exit status: when ids were given, fail (2) if any is unresolved or missing — i.e. needs action.
if [[ ${#ids[@]} -gt 0 ]]; then
  if [[ ${#missing[@]} -gt 0 ]]; then exit 2; fi
  unresolved=$(printf '%s' "$selected" | jq -s '[.[] | select(.resolved == false)] | length')
  [[ "$unresolved" -gt 0 ]] && exit 2
fi
exit 0
