# Code Review

Adaptive, host-neutral code review that routes a change to specialist reviewer lenses and
records findings as SARIF.

## Overview

This plugin's `review` skill is the core stage of a three-phase pipeline (set up work area →
review → structure findings). It detects the project's stack, selects the relevant reviewer
lenses, and dispatches each lens as an agent with its own context window — a sub-agent in your
host, or a separate CLI session — using the persona files under
`skills/review/resources/lenses/`.

Mechanical work is pushed into deterministic scripts (`skills/review/scripts/`): stack
detection and diff capture, plus a finding recorder that validates line numbers against the
real files and emits valid SARIF, and a renderer for a human-readable summary. Reviewer agents
only decide whether something is a problem and why; they never hand-author JSON or formatted
output.

v1 is findings-only and static — reviewers read and report, they do not edit files or run
build/lint/test. The work area persists on disk for a later phase to triage findings or convert
them into GitHub PR comments.
