---
name: toolsmith:approve
description: Proofread-then-allowlist handshake for a purpose-built toolsmith script
arguments:
  - name: path
    description: "Project-relative path to the script to approve (e.g. scripts/agent-tools/gh-pr-reactions)"
    required: true
---

Run the toolsmith approval handshake for the script at: `$ARGUMENTS`

This command couples an allowlist grant to one reviewed version of a script.
Follow these steps exactly and **never** add the permission rule without the
user's explicit confirmation in this turn. The mechanical, security-critical
steps — computing the sha256, pinning the registry entry, and granting the
permission rule — are performed by the deterministic
`toolsmith-approve.mjs` tool, never freehanded in prose.

1. **Locate and normalize.** Resolve the path relative to the project root and
   normalize it to a canonical project-relative form (strip any leading `./`;
   make it relative to the repo root, not absolute) so it matches the registry
   `path` and the eventual `Bash(<path>:*)` rule exactly — this avoids a
   near-duplicate allowlist entry. If the file does not exist, stop and say so.
   Read the script's **full contents** and print them in a fenced block so the
   user can proofread the exact bytes being approved.

2. **Ensure a draft registry entry exists.** Read
   `.claude/toolsmith/registry.json`. Find the entry whose `path` matches. The
   tool refuses to run against a path with no registry entry — it will never
   invent `name`/`purpose`/`args`/`scope`/`covers` on your behalf. If no entry
   exists, author a draft one now, following
   `skills/toolsmith/references/registry-schema.md`, and write it to the
   registry before continuing.

3. **Preview.** Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" "<path>"
   ```

   This is a read-only dry run — it writes nothing. Show its output to the
   user verbatim: the computed sha256 and the exact `Bash(<path>:*)` rule that
   would be granted.

4. **Confirm.** Ask the user to confirm they have read the script and approve
   both pinning it and adding that rule. If they decline or want changes, stop.

5. **On confirmation only, commit:**

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" "<path>" --commit
   ```

   This pins `status=approved` and `approvedSha256` on the registry entry,
   chmods the script executable, and adds exactly one `Bash(<path>:*)` rule to
   `.claude/settings.json` `permissions.allow` (it is a no-op if the rule is
   already present). The tool is fail-closed: any validation failure exits
   non-zero and writes nothing.

6. **Report** the tool's output (the pinned hash and the rule added), and
   remind the user that any later edit to the script will require re-running
   `/toolsmith:approve`.
