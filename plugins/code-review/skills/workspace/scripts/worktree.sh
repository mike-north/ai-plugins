#!/usr/bin/env bash
# worktree.sh — deterministic git worktree lifecycle for review/feature work.
#
# Compatible with bash 3.2+ (macOS system bash) and zsh-safe (invoked via `bash`,
# never sourced). Always operates on the MAIN repo containing $PWD, even when
# $PWD is itself inside another linked worktree.
#
# Usage: worktree.sh <subcommand> [args...]
#
# Subcommands:
#   create <name> [ref]           Create/reuse a worktree at .claude/worktrees/<name>
#                                  on branch <name>, from [ref] (default: origin's
#                                  default branch, fetched first).
#   for-pr <pr-number-or-url> [--force]
#                                  Create/refresh a worktree for reviewing a GitHub PR
#                                  at .claude/worktrees/review-pr-<N>, and write
#                                  <worktree>/.claude/review-meta.json. Refuses (exit 3)
#                                  to refresh onto a moved PR head if the worktree's
#                                  current commit isn't an ancestor of the new head
#                                  (would orphan local commits) — --force overrides.
#   setup <worktree-dir>          Run <dir>/.claude/worktree-setup.sh if present and
#                                  executable; otherwise print (not run) "RUN: <cmd>"
#                                  bootstrap lines detected from manifest files.
#   remove <name-or-path> [--force]
#                                  Remove a worktree (refuses if dirty unless --force);
#                                  deletes its branch if merged or a review-pr-<N> branch.
#   list                          List worktrees under .claude/worktrees/.
#   parse-pr-ref <pr-number-or-url>
#                                  (internal, network-free) Print the parsed
#                                  {number,host,owner,repo,isUrl} as JSON.
#
# Exit codes: 0 ok, 1 unexpected, 2 usage, 3 dirty/refused.
set -euo pipefail

GH_BIN="${GH:-gh}"

# ---------------------------------------------------------------------------
# shared helpers
# ---------------------------------------------------------------------------

err() {
  printf '%s\n' "$*" >&2
}

usage() {
  cat >&2 <<'EOF'
Usage: worktree.sh <subcommand> [args...]

  create <name> [ref]
  for-pr <pr-number-or-url> [--force]
  setup <worktree-dir>
  remove <name-or-path> [--force]
  list
  parse-pr-ref <pr-number-or-url>
EOF
}

# Find the MAIN repo root and its shared .git dir (git-common-dir), regardless
# of whether $PWD is the primary checkout or a linked worktree. Sets the
# globals REPO_ROOT and GIT_COMMON_DIR.
resolve_repo_root() {
  local common
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [[ -z "$common" ]]; then
    common="$(git rev-parse --git-common-dir 2>/dev/null || true)"
    if [[ -z "$common" ]]; then
      err "worktree.sh: not inside a git repository"
      exit 1
    fi
    if [[ "$common" != /* ]]; then
      common="$(cd "$(pwd)/$(dirname "$common")" && pwd)/$(basename "$common")"
    fi
  fi
  GIT_COMMON_DIR="$common"
  REPO_ROOT="$(cd "$(dirname "$common")" && pwd)"
}

# Ensure .claude/worktrees/ is git-ignored without touching the project's own
# .gitignore. Falls back to the shared .git/info/exclude (git-common-dir, so
# it applies from every worktree).
ensure_worktrees_ignored() {
  local worktrees_dir="$1"
  if git -C "$REPO_ROOT" check-ignore -q "$worktrees_dir" 2>/dev/null; then
    return 0
  fi
  local exclude_file="$GIT_COMMON_DIR/info/exclude"
  mkdir -p "$(dirname "$exclude_file")"
  if [[ -f "$exclude_file" ]] && grep -qxF '.claude/worktrees/' "$exclude_file" 2>/dev/null; then
    return 0
  fi
  printf '%s\n' '.claude/worktrees/' >>"$exclude_file"
  err "worktree.sh: .claude/worktrees/ was not gitignored; added it to $exclude_file"
}

# True if $1 (an existing path) is a worktree git already knows about.
is_registered_worktree() {
  local path="$1" abs
  abs="$(cd "$path" 2>/dev/null && pwd -P)" || return 1
  git worktree list --porcelain 2>/dev/null | awk -v p="$abs" '
    /^worktree / { wt = substr($0, 10) }
    wt == p { found = 1 }
    END { exit !found }
  '
}

# True if $1 (a worktree path) has no uncommitted changes (tracked or untracked).
is_clean_worktree() {
  local path="$1"
  [[ -z "$(git -C "$path" status --porcelain 2>/dev/null)" ]]
}

# Origin's default branch name, WITHOUT performing any network fetch — relies
# on refs/remotes/origin/HEAD already being populated (clone/fetch does this).
default_branch_name() {
  local ref
  ref="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -n "$ref" ]]; then
    printf '%s\n' "${ref#origin/}"
    return 0
  fi
  if git show-ref --verify --quiet refs/remotes/origin/main; then
    printf 'main\n'
    return 0
  fi
  if git show-ref --verify --quiet refs/remotes/origin/master; then
    printf 'master\n'
    return 0
  fi
  return 1
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# Minimal extractor for the single-line, flat JSON objects this script itself
# produces (string/bool values only — never used on third-party JSON).
json_field() {
  local json="$1" key="$2" pattern
  pattern="\"${key}\":\"([^\"]*)\""
  if [[ "$json" =~ $pattern ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  pattern="\"${key}\":(true|false)"
  if [[ "$json" =~ $pattern ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

# Network-free parse of a PR reference: a bare number ("123", "#123") or a PR
# URL ("https://<host>/<owner>/<repo>/pull/<n>[/...]"). Prints JSON on stdout
# and returns 0 on success; on failure prints an error message on stdout (the
# caller decides how to surface it) and returns 1.
parse_pr_ref() {
  local raw="$1" trimmed="${1#\#}"
  if [[ "$raw" =~ ^https?://([^/]+)/([^/]+)/([^/]+)/pull/([0-9]+)([/?].*)?$ ]]; then
    local host="${BASH_REMATCH[1]}" owner="${BASH_REMATCH[2]}" repo="${BASH_REMATCH[3]}" number="${BASH_REMATCH[4]}"
    printf '{"number":"%s","host":"%s","owner":"%s","repo":"%s","isUrl":true}\n' \
      "$number" "$(json_escape "$host")" "$(json_escape "$owner")" "$(json_escape "$repo")"
    return 0
  fi
  if [[ "$trimmed" =~ ^[0-9]+$ ]]; then
    printf '{"number":"%s","host":"","owner":"","repo":"","isUrl":false}\n' "$trimmed"
    return 0
  fi
  printf 'not a PR number or PR URL: %s' "$raw"
  return 1
}

# ---------------------------------------------------------------------------
# subcommands
# ---------------------------------------------------------------------------

cmd_parse_pr_ref() {
  if [[ $# -ne 1 ]]; then
    err "Usage: worktree.sh parse-pr-ref <pr-number-or-url>"
    return 2
  fi
  local out
  if out="$(parse_pr_ref "$1")"; then
    printf '%s\n' "$out"
    return 0
  fi
  err "worktree.sh: $out"
  return 2
}

cmd_create() {
  if [[ $# -lt 1 || $# -gt 2 ]]; then
    err "Usage: worktree.sh create <name> [ref]"
    return 2
  fi
  local name="$1" ref="${2:-}"
  if [[ -z "$name" || "$name" == */* || "$name" == "." || "$name" == ".." ]]; then
    err "worktree.sh: invalid worktree name: '$name'"
    return 2
  fi

  resolve_repo_root
  local worktrees_dir="$REPO_ROOT/.claude/worktrees"
  ensure_worktrees_ignored "$worktrees_dir"
  local wt_path="$worktrees_dir/$name"

  if [[ -e "$wt_path" ]]; then
    if is_registered_worktree "$wt_path" && is_clean_worktree "$wt_path"; then
      printf '%s\n' "$wt_path"
      return 0
    elif is_registered_worktree "$wt_path"; then
      err "worktree.sh: worktree '$name' exists and has uncommitted changes; refusing to recreate (use: worktree.sh remove $name --force)"
      return 3
    else
      err "worktree.sh: worktree '$name' at $wt_path is stale/broken; removing and recreating"
      rm -rf "$wt_path"
      git worktree prune >/dev/null 2>&1 || true
    fi
  fi

  local base_ref="$ref"
  if [[ -z "$base_ref" ]]; then
    git fetch origin --prune >/dev/null 2>&1 || true
    if ! base_ref="$(default_branch_name)"; then
      git remote set-head origin -a >/dev/null 2>&1 || true
      if ! base_ref="$(default_branch_name)"; then
        err "worktree.sh: unable to determine origin's default branch"
        return 1
      fi
    fi
  fi

  local resolved="origin/$base_ref"
  if ! git rev-parse --verify --quiet "${resolved}^{commit}" >/dev/null; then
    if git rev-parse --verify --quiet "${base_ref}^{commit}" >/dev/null; then
      resolved="$base_ref"
    else
      git fetch origin "$base_ref" >/dev/null 2>&1 || true
      if git rev-parse --verify --quiet "origin/${base_ref}^{commit}" >/dev/null; then
        resolved="origin/$base_ref"
      elif git rev-parse --verify --quiet 'FETCH_HEAD^{commit}' >/dev/null; then
        resolved="FETCH_HEAD"
      else
        err "worktree.sh: cannot resolve ref '$base_ref'"
        return 1
      fi
    fi
  fi

  mkdir -p "$worktrees_dir"
  if git show-ref --verify --quiet "refs/heads/$name"; then
    git worktree add "$wt_path" "$name" >/dev/null
  else
    git worktree add -b "$name" "$wt_path" "$resolved" >/dev/null
  fi
  printf '%s\n' "$wt_path"
}

write_review_meta() {
  local file="$1" pr="$2" host="$3" owner="$4" repo="$5" head_sha="$6" head_ref="$7" base_ref="$8" base_sha="$9"
  cat >"$file" <<EOF
{
  "pr": $pr,
  "host": "$(json_escape "$host")",
  "owner": "$(json_escape "$owner")",
  "repo": "$(json_escape "$repo")",
  "headSha": "$(json_escape "$head_sha")",
  "headRef": "$(json_escape "$head_ref")",
  "baseRef": "$(json_escape "$base_ref")",
  "baseSha": "$(json_escape "$base_sha")"
}
EOF
}

cmd_for_pr() {
  local force=false raw=""
  for a in "$@"; do
    case "$a" in
    --force)
      force=true
      ;;
    -*)
      err "worktree.sh: unknown flag: $a"
      return 2
      ;;
    *)
      raw="$a"
      ;;
    esac
  done
  if [[ -z "$raw" ]]; then
    err "Usage: worktree.sh for-pr <pr-number-or-url> [--force]"
    return 2
  fi
  local parsed host
  if ! parsed="$(parse_pr_ref "$raw")"; then
    err "worktree.sh: $parsed"
    return 2
  fi
  host="$(json_field "$parsed" host || true)"

  resolve_repo_root

  local tsv
  if [[ -n "$host" ]]; then
    tsv="$(GH_HOST="$host" "$GH_BIN" pr view "$raw" \
      --json number,headRefName,headRefOid,baseRefName,baseRefOid,url \
      -q '[.number,.headRefName,.headRefOid,.baseRefName,.baseRefOid,.url]|@tsv' 2>&1)" ||
      {
        err "worktree.sh: gh pr view failed: $tsv"
        return 1
      }
  else
    tsv="$("$GH_BIN" pr view "$raw" \
      --json number,headRefName,headRefOid,baseRefName,baseRefOid,url \
      -q '[.number,.headRefName,.headRefOid,.baseRefName,.baseRefOid,.url]|@tsv' 2>&1)" ||
      {
        err "worktree.sh: gh pr view failed: $tsv"
        return 1
      }
  fi

  local num head_ref head_sha base_ref base_sha pr_url
  IFS=$'\t' read -r num head_ref head_sha base_ref base_sha pr_url <<<"$tsv"

  local url_parsed url_host url_owner url_repo
  url_parsed="$(parse_pr_ref "$pr_url")"
  url_host="$(json_field "$url_parsed" host || true)"
  url_owner="$(json_field "$url_parsed" owner || true)"
  url_repo="$(json_field "$url_parsed" repo || true)"

  local worktrees_dir="$REPO_ROOT/.claude/worktrees"
  ensure_worktrees_ignored "$worktrees_dir"
  local wt_name="review-pr-$num"
  local wt_path="$worktrees_dir/$wt_name"
  local pr_ref="refs/pr/$num"

  if ! git fetch origin "+refs/pull/$num/head:$pr_ref" >/dev/null 2>&1; then
    err "worktree.sh: failed to fetch refs/pull/$num/head from origin"
    return 1
  fi
  git fetch origin "$base_ref" >/dev/null 2>&1 || true

  if [[ -e "$wt_path" ]]; then
    if is_registered_worktree "$wt_path"; then
      local current_sha
      current_sha="$(git -C "$wt_path" rev-parse HEAD 2>/dev/null || true)"
      if [[ "$current_sha" != "$head_sha" ]]; then
        if ! is_clean_worktree "$wt_path"; then
          err "worktree.sh: PR #$num head moved but '$wt_name' has uncommitted changes; refusing to refresh"
          return 3
        fi
        # checkout -B force-moves the branch tip; if the worktree's current
        # commit isn't an ancestor of the new head, it has content (commits)
        # the new head doesn't — moving the branch would strand them
        # (unreachable, eventually garbage-collected) with no warning.
        if ! $force && ! git -C "$wt_path" merge-base --is-ancestor "$current_sha" "$pr_ref"; then
          err "worktree.sh: PR #$num head moved, but '$wt_name' has local commit(s) ($current_sha) not reachable from the new head; refreshing would orphan them — re-run with --force to refresh anyway (the orphaned commit(s) remain recoverable via reflog until git gc), or 'worktree.sh remove $wt_name --force' to start over"
          return 3
        fi
        git -C "$wt_path" checkout -B "$wt_name" "$pr_ref" >/dev/null
      fi
    else
      err "worktree.sh: worktree '$wt_name' at $wt_path is stale/broken; removing and recreating"
      rm -rf "$wt_path"
      git worktree prune >/dev/null 2>&1 || true
    fi
  fi

  if [[ ! -e "$wt_path" ]]; then
    mkdir -p "$worktrees_dir"
    if git show-ref --verify --quiet "refs/heads/$wt_name"; then
      git worktree add "$wt_path" "$wt_name" >/dev/null
      git -C "$wt_path" reset --hard "$pr_ref" >/dev/null
    else
      git worktree add -b "$wt_name" "$wt_path" "$pr_ref" >/dev/null
    fi
  fi

  mkdir -p "$wt_path/.claude"
  write_review_meta "$wt_path/.claude/review-meta.json" \
    "$num" "$url_host" "$url_owner" "$url_repo" "$head_sha" "$head_ref" "$base_ref" "$base_sha"

  printf '%s\n' "$wt_path"
}

cmd_setup() {
  if [[ $# -ne 1 ]]; then
    err "Usage: worktree.sh setup <worktree-dir>"
    return 2
  fi
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    err "worktree.sh: not a directory: $dir"
    return 2
  fi

  local hook="$dir/.claude/worktree-setup.sh"
  if [[ -x "$hook" ]]; then
    cd "$dir"
    exec "$hook"
  fi

  if [[ -f "$dir/pnpm-lock.yaml" ]]; then
    echo "RUN: pnpm install --frozen-lockfile"
  fi
  if [[ -f "$dir/package-lock.json" ]]; then
    echo "RUN: npm ci"
  fi
  if [[ -f "$dir/yarn.lock" ]]; then
    echo "RUN: yarn install --frozen-lockfile"
  fi
  if [[ -f "$dir/Cargo.toml" ]]; then
    echo "RUN: cargo check"
  fi
  if [[ -f "$dir/go.mod" ]]; then
    echo "RUN: go build ./..."
  fi
  if [[ -f "$dir/pyproject.toml" && -f "$dir/poetry.lock" ]]; then
    echo "RUN: poetry install"
  fi
  if [[ -f "$dir/requirements.txt" ]]; then
    echo "RUN: pip install -r requirements.txt"
  fi
  return 0
}

cmd_remove() {
  local force=false target_arg=""
  for a in "$@"; do
    case "$a" in
    --force)
      force=true
      ;;
    -*)
      err "worktree.sh: unknown flag: $a"
      return 2
      ;;
    *)
      target_arg="$a"
      ;;
    esac
  done
  if [[ -z "$target_arg" ]]; then
    err "Usage: worktree.sh remove <name-or-path> [--force]"
    return 2
  fi

  resolve_repo_root
  local target
  if [[ "$target_arg" == */* ]]; then
    target="$target_arg"
  else
    target="$REPO_ROOT/.claude/worktrees/$target_arg"
  fi

  if [[ ! -e "$target" ]]; then
    err "worktree.sh: worktree not found: $target"
    return 1
  fi
  if ! is_registered_worktree "$target"; then
    err "worktree.sh: not a registered git worktree: $target"
    return 1
  fi
  if ! $force && ! is_clean_worktree "$target"; then
    err "worktree.sh: worktree has uncommitted changes; refusing to remove (use --force)"
    return 3
  fi

  local branch
  branch="$(git -C "$target" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

  if $force; then
    git worktree remove --force "$target"
  else
    git worktree remove "$target"
  fi

  if [[ -n "$branch" && "$branch" != "HEAD" ]]; then
    if [[ "$branch" =~ ^review-pr-[0-9]+$ ]]; then
      git branch -D "$branch" >/dev/null 2>&1 || true
    else
      local default_branch
      if default_branch="$(default_branch_name)"; then
        if git branch --merged "$default_branch" 2>/dev/null | grep -qxF "  $branch"; then
          git branch -d "$branch" >/dev/null 2>&1 || true
        fi
      fi
    fi
  fi

  printf '%s\n' "$target"
}

cmd_list() {
  resolve_repo_root
  local worktrees_dir="$REPO_ROOT/.claude/worktrees"
  git worktree list 2>/dev/null | grep -F "$worktrees_dir/" || true
  return 0
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 2
  fi
  local cmd="$1"
  shift
  case "$cmd" in
  create) cmd_create "$@" ;;
  for-pr) cmd_for_pr "$@" ;;
  setup) cmd_setup "$@" ;;
  remove) cmd_remove "$@" ;;
  list) cmd_list "$@" ;;
  parse-pr-ref) cmd_parse_pr_ref "$@" ;;
  -h | --help | help)
    usage
    exit 0
    ;;
  *)
    err "worktree.sh: unknown subcommand: $cmd"
    usage
    exit 2
    ;;
  esac
}

main "$@"
