---
name: toolsmith:approve
description: Proofread-then-allowlist handshake for a purpose-built toolsmith script
arguments:
  - name: path
    description: "Project-relative path to a project tool (e.g. scripts/agent-tools/gh-pr-reactions), or the name (or tools/<name> path) of a user-scope tool under ~/.claude/toolsmith/tools/"
    required: true
---

Run the toolsmith approval handshake for the script at: `$ARGUMENTS`

This command couples an allowlist grant to one reviewed version of a script.
Follow these steps exactly and **never** add the permission rule without the
user's explicit confirmation in this turn. The mechanical, security-critical
steps — computing the sha256, pinning the registry entry, and granting the
permission rule — are performed by the deterministic
`toolsmith-approve.mjs` tool, never freehanded in prose.

1. **Decide the scope.** If `$ARGUMENTS` is (or normalizes to) a path meant to
   live under `~/.claude/toolsmith/tools/` — i.e. a bare name or a
   `tools/<name>` path that does not exist inside this project — this is a
   **user-scope (global)** tool: use `--user` on every `toolsmith-approve.mjs`
   invocation below and resolve everything relative to
   `~/.claude/toolsmith/`. Otherwise this is a **project-scope** tool: resolve
   relative to the project root, no `--user` flag. When in doubt, check
   whether the path exists under the project first; only treat it as
   user-scope if it doesn't and looks like a bare tool name or `tools/<name>`.

2. **Locate and normalize.**
   - **Project scope:** resolve the path relative to the project root and
     normalize it to a canonical project-relative form (strip any leading
     `./`; make it relative to the repo root, not absolute) so it matches the
     registry `path` and the eventual `Bash(<path>:*)` rule exactly — this
     avoids a near-duplicate allowlist entry.
   - **User scope:** normalize a bare name to `tools/<name>`; the file lives
     at `~/.claude/toolsmith/tools/<name>` and the eventual rule is
     `Bash(<ABS>:*)` where `<ABS>` is that fully-expanded absolute path.

   If the file does not exist, stop and say so. Read the script's **full
   contents** and print them in a fenced block so the user can proofread the
   exact bytes being approved.

3. **Ensure a draft registry entry exists.** Read the registry for the chosen
   scope — `.claude/toolsmith/registry.json` (project) or
   `~/.claude/toolsmith/registry.json` (user). Find the entry whose `path`
   matches. The tool refuses to run against a path with no registry entry — it
   will never invent `name`/`purpose`/`args`/`scope`/`covers` on your behalf.
   If no entry exists, author a draft one now, following
   `skills/toolsmith/references/registry-schema.md`, and write it to the
   correct registry before continuing.

4. **Preview.** Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" "<path>"
   ```

   or, for a user-scope tool:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" "<name-or-tools/path>" --user
   ```

   This is a read-only dry run — it writes nothing. Show its output to the
   user verbatim: the tool name, the (absolute, for user scope) script path,
   the computed sha256, and the exact `Bash(...:*)` rule that would be
   granted.

5. **Confirm.** Ask the user to confirm they have read the script and approve
   both pinning it and adding that rule. If they decline or want changes, stop.

6. **On confirmation only, commit:**

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" "<path>" --commit
   ```

   or, for a user-scope tool, add `--user` to the commit invocation as well:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" "<name-or-tools/path>" --user --commit
   ```

   This pins `status=approved` and `approvedSha256` on the registry entry,
   chmods the script executable, and adds exactly one `Bash(...:*)` rule to
   the scope's `settings.json` `permissions.allow`
   (`.claude/settings.json` for project scope, `~/.claude/settings.json` for
   user scope; it is a no-op if the rule is already present). The tool is
   fail-closed: any validation failure exits non-zero and writes nothing.

7. **Report** the tool's output (the pinned hash and the rule added). For a
   user-scope tool, remind the user it must be invoked by its fully-expanded
   absolute path so the granted rule matches. Remind the user that any later
   edit to the script will require re-running `/toolsmith:approve` (with
   `--user` again, if applicable).
