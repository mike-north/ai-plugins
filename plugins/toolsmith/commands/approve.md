---
name: toolsmith:approve
description: Proofread-then-promote handshake that moves a purpose-built toolsmith staging draft to live
arguments:
  - name: path
    description: "Project-relative path the tool will live at (e.g. scripts/agent-tools/gh-pr-reactions), or the name (or tools/<name> path) of a user-scope tool under ~/.claude/toolsmith/tools/"
    required: true
---

Run the toolsmith promotion handshake for the tool registered at: `$ARGUMENTS`

This command couples an allowlist grant to one reviewed version of a script,
promoted from staging to live per
[`docs/toolsmith/staged-live-split.md`](../../../docs/toolsmith/staged-live-split.md).
Follow these steps exactly and **never** add the permission rule, or place
bytes at the live path, without the user's explicit confirmation in this
turn. The mechanical, security-critical steps — reading the staged draft,
placing it at live, computing the sha256, pinning the registry entry, and
granting the permission rule — are performed by the deterministic
`toolsmith-approve.mjs` tool, never freehanded in prose.

1. **Decide the scope.** If `$ARGUMENTS` is (or normalizes to) a path meant to
   live under `~/.claude/toolsmith/tools/` — i.e. a bare name or a
   `tools/<name>` path that does not exist inside this project — this is a
   **user-scope (global)** tool: use `--user` on every `toolsmith-approve.mjs`
   invocation below and resolve everything relative to
   `~/.claude/toolsmith/`. Otherwise this is a **project-scope** tool: resolve
   relative to the project root, no `--user` flag.

2. **Locate the registry entry.** Read the registry for the chosen scope —
   `.claude/toolsmith/registry.json` (project) or
   `~/.claude/toolsmith/registry.json` (user). Find the entry whose (live)
   `path` matches `$ARGUMENTS`. The tool refuses to run against a path with no
   registry entry, or against an entry with no `staged` field — it never
   invents `name`/`purpose`/`args`/`scope`/`covers`/`staged` on your behalf.
   If no entry or no staged draft exists, stop: the draft must be authored
   under the staging namespace first (see
   `skills/toolsmith/references/authoring-checklist.md`).

3. **Preview.** Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" "<path>" --dry-run
   ```

   or, for a user-scope tool:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" "<name-or-tools/path>" --user --dry-run
   ```

   This is a read-only dry run — it writes nothing. Show its output to the
   user verbatim: the tool name, whether this is a new tool or a revision, the
   **review surface** (a diff against current live for a revision, the full
   staged text for a new tool — exactly what would be placed), the computed
   sha256 of the staged bytes, and the exact `Bash(...:*)` rule that would be
   granted.

4. **Confirm.** Ask the user to confirm they have read the review surface and
   approve both promoting it and adding that rule. If they decline or want
   changes, stop — the draft stays in staging, inert, and the previous live
   version (if any) keeps serving every invocation untouched.

5. **On confirmation only, promote (the bare command — no flag needed):**

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" "<path>"
   ```

   or, for a user-scope tool, keep `--user` on the invocation as well:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" "<name-or-tools/path>" --user
   ```

   This places the staged bytes at the live path (atomically), sets the live
   file to `0555` (no write bit) plus the BSD immutable flag where available,
   recomputes the sha256 from the bytes actually placed and pins it as
   `approvedSha256`, flips `status` to `approved`, adds exactly one
   `Bash(...:*)` rule to the scope's `settings.json` `permissions.allow`
   (`.claude/settings.json` for project scope, `~/.claude/settings.json` for
   user scope; no-op if already present), clears the entry's `staged` field,
   and removes the staging file. The tool is fail-closed: any validation
   failure before placement exits non-zero and writes nothing; if killed
   mid-promotion, live is left refused-closed (its pin won't match) until
   re-run, and re-running converges rather than double-applying.

6. **Report** the tool's output (what was promoted, the pinned hash, and the
   rule added). For a user-scope tool, remind the user it must be invoked by
   its fully-expanded absolute path so the granted rule matches. Remind the
   user that any future change to this tool must go back through staging —
   author the revision there and repeat this handshake; the live version
   never accepts a direct edit.
