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
user's explicit confirmation in this turn.

1. **Locate and normalize.** Resolve the path relative to the project root and
   normalize it to a canonical project-relative form (strip any leading `./`;
   make it relative to the repo root, not absolute) so it matches the registry
   `path` and the eventual `Bash(<path>:*)` rule exactly — this avoids a
   near-duplicate allowlist entry. If the file does not exist, stop and say so.
   Read the script's **full contents** and print them in a fenced block so the
   user can proofread the exact bytes being approved.

2. **Show the registry entry.** Read `.claude/toolsmith/registry.json`. Find the
   entry whose `path` matches (or draft one now if missing, following
   `skills/toolsmith/references/registry-schema.md`: `name`, `path`, `purpose`,
   `args`, `scope`, `covers`). Show the entry and the **exact** permission rule
   that will be added: `Bash(<path>:*)`.

3. **Confirm.** Ask the user to confirm they have read the script and approve
   both pinning it and adding that rule. If they decline or want changes, stop.

4. **On confirmation only:**
   - Compute the sha256 of the file contents:
     `shasum -a 256 "<path>" | awk '{print $1}'` (or `sha256sum`). This must be
     the hash of the raw file bytes, matching what the PreToolUse hook computes.
   - Update the registry entry: set `status` to `approved`, `approvedSha256` to
     that hash, and `permissionRule` to `Bash(<path>:*)`.
   - Add the rule to the project `.claude/settings.json` `permissions.allow`
     array (create the file/keys if absent; do not duplicate an existing rule).
   - Ensure the script is executable (`chmod +x <path>`).

5. **Report** the pinned hash and the rule added, and remind the user that any
   later edit to the script will require re-running `/toolsmith:approve`.
