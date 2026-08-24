#!/bin/bash
# Cheap PreToolUse gate in front of toolsmith-check.mjs. Runs on every Bash
# tool call, so the common no-op path must stay fast: if NEITHER the project
# nor the user (~/.claude/toolsmith/) has a toolsmith registry there is
# nothing to redirect to and no hash to check, so exit immediately without
# spawning node. This one check covers the vast majority of shells (those not
# using toolsmith at either scope).
#
# When a registry DOES exist, the project has opted into this discipline, so we
# hand every Bash command to the node brain rather than trying to pre-filter
# candidates here: a bash/jq pre-filter that is even slightly narrower than the
# brain's own logic silently disarms the redirect or the tamper block for the
# commands it wrongly skips. Correctness wins over the ~90ms node startup for a
# project that asked for this. toolsmith-check.mjs makes the precise decision
# (executable-position invocation, sha256, effective watchlist, covers).
#
# Measured in scripts/bench.sh (#38): the not-opted-in exit above stays a few
# ms above bare fork/exec overhead, while piping hooks/payload-adapter (#34)
# in front of this script roughly doubles that cost for every Bash call in
# every project, including ones that never opted into toolsmith. Adapter
# adoption was declined for this hot path on that basis; see #38 for the
# numbers and #34 for the scoped exception this carves out.
[ "${CLAUDE_TOOLSMITH_HOOK:-}" = "off" ] && exit 0

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
input=$(cat)

root="${CLAUDE_PROJECT_DIR:-${CURSOR_PROJECT_DIR:-}}"
# Only reach for jq to read .cwd when it's actually installed; missing jq must
# fail open silently (no "command not found" noise on every Bash call), so fall
# back to $PWD instead. The hosts pass a project-dir env var anyway.
if [ -z "$root" ] && command -v jq >/dev/null 2>&1; then
  root=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
fi
[ -n "$root" ] || root="$PWD"

# The registry-absent fast exit below must not skip the approve-guard rule in
# toolsmith-check.mjs (a best-effort nudge against freehanding
# toolsmith-approve.mjs — see its own comment), which applies whether or not
# this project has opted into a registry at all. This substring match is
# deliberately broader than the precise invocation check in toolsmith-check.mjs
# (which ignores mere references like `cat`/`grep` on the file): a prefilter
# false-negative would silently disable the guard, while a false-positive only
# costs one node spawn on a rare command shape.
case "$input" in
  *toolsmith-approve.mjs*) ;; # always hand to node, regardless of registry state
  *)
    if [ ! -f "$root/.claude/toolsmith/registry.json" ] && [ ! -f "$HOME/.claude/toolsmith/registry.json" ]; then
      exit 0
    fi
    ;;
esac

printf '%s' "$input" | node "$dir/toolsmith-check.mjs"
