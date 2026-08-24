#!/bin/bash
# Thin PreToolUse gate in front of toolsmith-write-check.mjs (write-denial
# layer 2 — docs/toolsmith/staged-live-split.md §write denial). Unlike
# toolsmith-gate.sh, this rule is NOT registry-gated: a live tool directory
# and a scope's settings.json are protected unconditionally, whether or not
# the project has opted into toolsmith at all, so there is no "registry
# absent -> exit fast" short-circuit to apply here. The only fast exit is the
# shared escape hatch.
[ "${CLAUDE_TOOLSMITH_HOOK:-}" = "off" ] && exit 0

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$dir/toolsmith-write-check.mjs"
