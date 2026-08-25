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
The mechanical, security-critical steps — reading the staged draft, placing it
at live, computing the sha256, pinning the registry entry, and granting the
permission rule — are performed by the deterministic `toolsmith` CLI, never
freehanded in prose. **The commit run is a human act**: you only ever run the
read-only preview.

1. **Decide the scope.** If `$ARGUMENTS` is (or normalizes to) a path meant to
   live under `~/.claude/toolsmith/tools/` — i.e. a bare name or a
   `tools/<name>` path that does not exist inside this project — this is a
   **user-scope (global)** tool: use `--user` on every CLI invocation below.
   Otherwise this is a **project-scope** tool: no `--user` flag.

2. **Locate the registry entry.** Read the registry for the chosen scope —
   `.claude/toolsmith/registry.json` (project) or
   `~/.claude/toolsmith/registry.json` (user). Find the entry whose (live)
   `path` matches `$ARGUMENTS`. The CLI refuses to run against a path with no
   registry entry, or against an entry with no `staged` field — it never
   invents `name`/`purpose`/`args`/`scope`/`covers`/`staged` on your behalf.
   If no entry or no staged draft exists, stop: the draft must be authored
   under the staging namespace first (see
   `skills/toolsmith/references/authoring-checklist.md`).

3. **Preview.** Run:

   ```
   "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith.mjs" approve "<path>" --dry-run
   ```

   (add `--user` for a user-scope tool). This is a read-only dry run — it
   writes nothing. It also runs the proposal gate (`toolsmith lint`) over the
   staged draft and refuses if the draft has lint errors; fix those in
   staging first. Show its output to the user verbatim: the tool name,
   whether this is a new tool or a revision, the **review surface** (a diff
   against current live for a revision, the full staged text for a new tool —
   exactly what would be placed), the computed sha256 of the staged bytes,
   any lint warnings, and the exact `Bash(...:*)` rule that would be granted.

4. **Hand the promotion command to the user — never run it yourself.** The
   commit run is a human act performed in the user's own terminal (the
   toolsmith hooks deny agent-run commit invocations; only read-only verbs
   pass). Print the exact command with `${CLAUDE_PLUGIN_ROOT}` expanded to
   its real absolute path so it is copy-pasteable:

   ```
   "<absolute-plugin-root>/scripts/toolsmith.mjs" approve "<path>"
   ```

   (with `--user` for a user-scope tool). `toolsmith approve --help` is
   written for that human and explains exactly what the commit does: place
   the staged bytes atomically, set the live file to `0555` plus the BSD
   immutable flag where available, recompute the sha256 from the placed
   bytes and pin it, add exactly one `Bash(...:*)` rule to the scope's
   `settings.json`, clear the entry's `staged` field, and remove the staging
   file. It is fail-closed and idempotent: interrupted promotions leave live
   refused-closed until a re-run, and re-running converges.

   If the user declines or wants changes, stop — the draft stays in staging,
   inert, and the previous live version (if any) keeps serving every
   invocation untouched.

5. **Verify and report.** Once the user says they've run it, confirm the
   promotion landed with the read-only check:

   ```
   "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith.mjs" verify
   ```

   (add `--user` for user scope) and report what was promoted, the pinned
   hash, and the rule added. For a user-scope tool, remind the user it must
   be invoked by its fully-expanded absolute path so the granted rule
   matches. Remind the user that any future change to this tool must go back
   through staging — author the revision there and repeat this handshake; the
   live version never accepts a direct edit.
