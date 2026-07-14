---
name: toolsmith:list
description: Show the toolsmith registry and flag any approved tool whose file drifted from its pinned hash
---

Show the state of this project's purpose-built tools.

1. Read `.claude/toolsmith/registry.json`. If it is missing, say no tools are
   registered yet and point to the toolsmith skill for how to forge one. If it
   exists but does not parse as JSON, report a **parse error prominently** —
   the hook fails open on a malformed registry, so the redirect and tamper
   block are silently disarmed until the JSON is fixed. Do not report "no tools
   registered" in that case.

2. For each tool, print: `name`, `path`, `status` (draft/approved), `purpose`,
   and `args`.

3. For each **approved** tool, verify integrity: compute
   `shasum -a 256 "<path>" | awk '{print $1}'` and compare to `approvedSha256`.
   Mark each as one of:
   - **OK** — file present and hash matches (runs without a prompt),
   - **DRIFTED** — hash differs from the pinned value (the hook will block it;
     re-run `/toolsmith:approve <path>` after re-review),
   - **MISSING** — the file no longer exists.

4. List any `draft` tools separately as awaiting approval.

Render as a compact table and summarize how many tools are OK / drifted /
missing / draft.
