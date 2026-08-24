#!/bin/bash
# Thin PreToolUse gate in front of toolsmith-write-check.mjs (write-denial
# layer 2 — docs/toolsmith/staged-live-split.md §write denial). Unlike
# toolsmith-gate.sh, this rule is NOT registry-gated: a live tool directory,
# a scope's settings.json, and the history log are protected unconditionally,
# whether or not the project has opted into toolsmith at all.
#
# The matcher now includes Read (for the history.jsonl redirect), which is a
# high-volume tool — so a cheap substring prefilter keeps the common case
# (reading ordinary files) from spawning node at all. The substrings must
# over-approximate every path toolsmith-write-check.mjs could deny; a
# prefilter false-negative would silently disable the rule.
[ "${CLAUDE_TOOLSMITH_HOOK:-}" = "off" ] && exit 0

input=$(cat)

case "$input" in
  *agent-tools*|*toolsmith*|*settings.json*) ;;
  *) exit 0 ;;
esac

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '%s' "$input" | node "$dir/toolsmith-write-check.mjs"
