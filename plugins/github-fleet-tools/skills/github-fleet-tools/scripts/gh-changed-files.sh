#!/usr/bin/env bash
#
# gh-changed-files.sh — list a PR's (or a compare range's) changed files + line stats.
#
# A bounded, read-only (GET-only) wrapper over the GitHub compare API — the remote/API
# complement to the `git` plugin's local `diff-stats.sh`. Use it for any PR or ref range,
# in any repo, without a local checkout. Because it only ever GETs `compare`, it can be
# allowlisted (`Bash(gh-changed-files.sh:*)`) while raw `gh api` stays gated.
#
# (vs `diff-stats.sh`: that one is LOCAL — needs a checkout, aggregates meaningful/raw
#  line counts for review effort. This one is REMOTE — per-file status for any PR/ref.)
#
# Usage:
#   gh-changed-files.sh <PR_NUMBER>            [--repo owner/name] [--json]
#   gh-changed-files.sh <base>...<head>        [--repo owner/name] [--json]
#
#   gh-changed-files.sh 154
#   gh-changed-files.sh main...feature-x --json
#   gh-changed-files.sh 154 --repo mike-north/allw
#
# Default output: one tab-separated row per file — `status<TAB>+additions<TAB>-deletions<TAB>filename`.
# --json: an array of { filename, status, additions, deletions }.
#
# Exit codes: 0 success; 1 gh/API error; 2 bad usage.
#
# Env: GH (override the gh binary), GH_HOST (force a hostname).
#
set -euo pipefail

GH="${GH:-gh}"
[[ -n "${GH_HOST:-}" ]] && export GH_HOST

target=""
repo=""
json=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) json=1; shift ;;
    --repo) repo="${2:-}"; shift 2 ;;
    -*) echo "unknown argument: $1" >&2; exit 2 ;;
    *)
      if [[ -z "$target" ]]; then target="$1"; else echo "unexpected extra argument: $1" >&2; exit 2; fi
      shift ;;
  esac
done

if [[ -z "$target" ]]; then
  echo "usage: gh-changed-files.sh (<PR_NUMBER> | <base>...<head>) [--repo owner/name] [--json]" >&2
  exit 2
fi

# Resolve owner/repo.
if [[ -z "$repo" ]]; then
  repo="$("$GH" repo view --json nameWithOwner --jq .nameWithOwner)"
fi
if ! [[ "$repo" =~ ^[^/]+/[^/]+$ ]]; then
  echo "--repo must be owner/name (got: $repo)" >&2
  exit 2
fi

# Determine the compare range: numeric → a PR (resolve base...head); else expect base...head.
if [[ "$target" =~ ^[0-9]+$ ]]; then
  read -r base head < <("$GH" api "repos/$repo/pulls/$target" --jq '"\(.base.ref) \(.head.sha)"')
  if [[ -z "${base:-}" || -z "${head:-}" ]]; then
    echo "could not resolve base/head for PR #$target in $repo" >&2
    exit 1
  fi
  range="$base...$head"
elif [[ "$target" == *...* ]]; then
  range="$target"
else
  echo "argument must be a PR number or a 'base...head' range (got: $target)" >&2
  exit 2
fi

if [[ "$json" == "1" ]]; then
  "$GH" api "repos/$repo/compare/$range" \
    --jq '[.files[] | { filename, status, additions, deletions }]'
else
  "$GH" api "repos/$repo/compare/$range" \
    --jq '.files[] | "\(.status)\t+\(.additions)\t-\(.deletions)\t\(.filename)"'
fi
