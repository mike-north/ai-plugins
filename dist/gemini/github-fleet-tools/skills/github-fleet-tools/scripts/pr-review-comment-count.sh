#!/usr/bin/env bash
#
# pr-review-comment-count.sh — count a PR's INLINE review comments.
#
# Inline review comments are the line-anchored comments a reviewer leaves on the
# diff (the `pulls/N/comments` REST collection) — as opposed to issue-style PR
# discussion comments (`issues/N/comments`) or the top-level review summary body.
# This is the count you want when deciding whether an automated reviewer (e.g.
# Copilot) left actionable findings, and how many still need action before merge.
#
# It prints:
#   1. Total inline review comments (paginated — counts across all pages).
#   2. A per-author breakdown (so you can isolate Copilot's count from humans').
#   3. A resolved / unresolved split by review thread, since the merge policy
#      gate is "Copilot's review completed AND all feedback acted on or tracked"
#      — unresolved > 0 means there is still something to address or reply to.
#
# An optional AUTHOR_SUBSTRING filters the total/breakdown to matching logins
# (case-insensitive), e.g. "copilot" to count only the bot's inline comments.
#
# Read-only companion to pr-status.sh (which lists the unresolved threads + their
# reply ids) and pr-reply-resolve.sh (which acts on one).
#
# Usage:
#   pr-review-comment-count.sh [PR_NUMBER] [AUTHOR_SUBSTRING]
#
#   pr-review-comment-count.sh                 # current branch's PR, all authors
#   pr-review-comment-count.sh 62              # PR #62, all authors
#   pr-review-comment-count.sh 62 copilot      # only logins containing "copilot"
#
# Exit codes: 0 success; 1 no PR found / API error; 2 bad usage.
#
# Env:
#   GH       override the gh binary (e.g. GH=/opt/homebrew/bin/gh to bypass a wrapper)
#   GH_HOST  force a hostname (e.g. GH_HOST=github.com on a corp-wrapped gh)
#
set -euo pipefail

GH="${GH:-gh}"
[[ -n "${GH_HOST:-}" ]] && export GH_HOST

pr="${1:-}"
author="${2:-}"

if [[ "$pr" == "-h" || "$pr" == "--help" ]]; then
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi
if [[ -n "$pr" ]] && ! [[ "$pr" =~ ^[0-9]+$ ]]; then
  echo "PR_NUMBER must be numeric (got: $pr)" >&2
  exit 2
fi

nameWithOwner=$("$GH" repo view --json nameWithOwner --jq .nameWithOwner)
owner="${nameWithOwner%%/*}"
repo="${nameWithOwner##*/}"

if [[ -z "$pr" ]]; then
  pr=$("$GH" pr view --json number --jq .number 2>/dev/null || true)
  if [[ -z "$pr" ]]; then
    echo "No PR number given and no PR found for the current branch." >&2
    exit 1
  fi
fi

# All inline review-comment authors, one login per line, across every page.
# --paginate streams each page; --jq emits one element per line so the aggregate
# is just the concatenation (no cross-page array merge needed).
logins=$("$GH" api --paginate "repos/$owner/$repo/pulls/$pr/comments" \
  --jq '.[].user.login' 2>/dev/null || true)

# Case-insensitive author filter, if requested.
if [[ -n "$author" ]]; then
  logins=$(printf '%s\n' "$logins" | grep -i -- "$author" || true)
fi
# Count non-empty lines (grep -c '.' ignores the trailing blank from printf).
total=$(printf '%s\n' "$logins" | grep -c '.' || true)

echo "=== INLINE REVIEW COMMENTS: PR #$pr ($owner/$repo) ==="
[[ -n "$author" ]] && echo "(filtered to authors matching: \"$author\")"
echo
echo "Total: $total"
echo
echo "By author:"
if [[ "$total" -eq 0 ]]; then
  echo "  (none)"
else
  printf '%s\n' "$logins" | grep '.' | sort | uniq -c | sort -rn \
    | sed 's/^/  /'
fi

# Resolved / unresolved split by review thread. Inline comments live in threads;
# unresolved threads are the ones still needing a reply or fix before merge.
echo
echo "Threads (inline-comment review threads):"
"$GH" api graphql -f owner="$owner" -f repo="$repo" -F pr="$pr" -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:100) {
        pageInfo { hasNextPage }
        totalCount
        nodes { isResolved }
      }
    }
  }
}' --jq '
  .data.repository.pullRequest.reviewThreads as $t
  | ($t.nodes | length) as $seen
  | ([$t.nodes[] | select(.isResolved)] | length) as $resolved
  | "  resolved:   \($resolved)\n  unresolved: \($seen - $resolved)\n  total:      \($t.totalCount)"
    + (if $t.pageInfo.hasNextPage then "\n  (note: >100 threads; resolved/unresolved counts cover the first 100)" else "" end)
' 2>/dev/null || echo "  (thread data unavailable)"
