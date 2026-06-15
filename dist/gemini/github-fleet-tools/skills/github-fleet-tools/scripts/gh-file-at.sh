#!/usr/bin/env bash
#
# gh-file-at.sh — print a file's contents at a given ref, via the GitHub contents API.
#
# The remote/API analog of `git show <ref>:<path>` — read a file at any commit / branch /
# tag in any repo, without a local checkout. Bounded, read-only (GET `contents` only), so
# it's allowlistable (`Bash(gh-file-at.sh:*)`) while raw `gh api` stays gated.
#
# Usage:
#   gh-file-at.sh <ref> <path> [--repo owner/name]
#
#   gh-file-at.sh 32bc32c crates/allw-uniffi/src/lib.rs
#   gh-file-at.sh main README.md --repo mike-north/allw
#
# Prints the file's bytes to stdout. Note: the contents API caps at ~1 MB; larger files
# are reported as an error (use the blobs/raw API for those).
#
# Exit codes: 0 success; 1 not found / too large / API error; 2 bad usage.
#
# Env: GH (override the gh binary), GH_HOST (force a hostname).
#
set -euo pipefail

GH="${GH:-gh}"
[[ -n "${GH_HOST:-}" ]] && export GH_HOST

ref=""
path=""
repo=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="${2:-}"; shift 2 ;;
    -*) echo "unknown argument: $1" >&2; exit 2 ;;
    *)
      if [[ -z "$ref" ]]; then ref="$1"
      elif [[ -z "$path" ]]; then path="$1"
      else echo "unexpected extra argument: $1" >&2; exit 2; fi
      shift ;;
  esac
done

if [[ -z "$ref" || -z "$path" ]]; then
  echo "usage: gh-file-at.sh <ref> <path> [--repo owner/name]" >&2
  exit 2
fi

if [[ -z "$repo" ]]; then
  repo="$("$GH" repo view --json nameWithOwner --jq .nameWithOwner)"
fi
if ! [[ "$repo" =~ ^[^/]+/[^/]+$ ]]; then
  echo "--repo must be owner/name (got: $repo)" >&2
  exit 2
fi

# Fetch the contents entry. The API encoding is base64 for a file; a directory returns an
# array (encoding empty) and a too-large file returns encoding "none".
resp="$("$GH" api "repos/$repo/contents/$path?ref=$ref" 2>/dev/null)" || {
  echo "not found: $path @ $ref in $repo (or API error)" >&2
  exit 1
}

type="$(printf '%s' "$resp" | jq -r 'if type=="array" then "dir" else (.type // "?") end')"
if [[ "$type" != "file" ]]; then
  echo "not a file: $path @ $ref in $repo (type: $type)" >&2
  exit 1
fi

encoding="$(printf '%s' "$resp" | jq -r '.encoding // ""')"
if [[ "$encoding" != "base64" ]]; then
  echo "cannot read $path @ $ref: contents API returned encoding '$encoding' (file likely >1 MB — use the blobs/raw API)" >&2
  exit 1
fi

printf '%s' "$resp" | jq -r '.content' | base64 -d
