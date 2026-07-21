---
name: toolsmith:list
description: Show the toolsmith registry and flag any approved tool whose file drifted from its pinned hash
---

Show the state of both the project's and the user's purpose-built tools.

1. Read `.claude/toolsmith/registry.json` (project scope) and
   `~/.claude/toolsmith/registry.json` (user scope). Either or both may be
   missing — that's fine, just report no tools registered for that scope. If
   a registry file exists but does not parse as JSON, report a **parse error
   prominently** for that scope — the hook fails open on a malformed registry,
   so the redirect and tamper block are silently disarmed until the JSON is
   fixed. Do not report "no tools registered" in that case.

2. For each tool in each registry, print: `name`, `path`, `status`
   (draft/approved), `purpose`, and `args`.

3. Verify integrity deterministically — do not compute hashes by hand. Run
   both:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" --verify
   node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-approve.mjs" --verify --user
   ```

   Each is a read-only check; it prints one line per registry tool, prefixed
   with its status:
   - **OK** — file present and hash matches (runs without a prompt),
   - **DRIFTED** — hash differs from the pinned value (the hook will block it;
     re-run `/toolsmith:approve <path>` — with `--user` for a user tool —
     after re-review),
   - **MISSING** — the file no longer exists,
   - **draft** — not yet approved.

   Use their output to populate the tables below rather than re-deriving
   hashes in prose.

4. Render as two tables, grouped **Project tools** and **User tools**, each
   listing every tool with its OK/DRIFTED/MISSING/draft status (this reflects
   the LIVE pin only — see step 5 for pending staged drafts, which are a
   separate concern per docs/toolsmith/staged-live-split.md).

5. **Pending drafts.** For each registry entry (either scope) carrying a
   `staged` field, render a **Pending drafts** section (per scope) listing:
   `name`, `staged.note`, `staged.since`, and a **three-way drift state**
   comparing:
   - the entry's pinned `approvedSha256` (what the hook currently enforces),
   - the live file's actual on-disk hash (from the OK/DRIFTED/MISSING check
     above),
   - the staged file's actual on-disk hash (compute it directly — sha256 of
     the file at the resolved `staged.path`; do not trust `staged.sha256`,
     which is advisory bookkeeping only).

   Report one of: **pending** (live matches its pin; staged differs from live
   — the normal case, a draft awaiting promotion), **live-drifted-too** (live
   itself no longer matches its pin — surface this prominently, since
   promoting now would be reviewing a stale diff), or **staged-missing** (the
   registry references a `staged.path` that doesn't exist on disk — the entry
   claims a pending draft that isn't there). For a brand-new tool (`status:
   draft`, no live path active yet), report **new** instead of a drift state.

Summarize how many tools are OK / drifted / missing / draft, per scope and in
total, plus how many pending drafts exist per scope. Remember: a project tool
shadows a same-named user tool — if both registries define the same `name`,
note that the project entry governs.
