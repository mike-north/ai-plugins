# Consolidation — memory store & the one-fact-per-file format

## Resolve the store (first match wins)

1. **Native memory subsystem.**
   - **Claude Code:** the auto-memory directory for this project —
     `…/memory/MEMORY.md` (the index) plus `memory/*.md` (one file per fact).
   - **Codex:** the `memories` store.
2. **Polyfill** — if there is no native store, use an `AGENTS.md` `## Facts` section
   as the memory surface (the same one-fact-per-line idea, inline).

Read the index first so consolidation **merges into** what exists instead of
duplicating it.

## The one-fact-per-file format (do NOT use topic files)

Each memory is **one file holding one fact**, with frontmatter:

```markdown
---
name: <short-kebab-case-slug>
description: <one-line summary — used to judge relevance on recall>
metadata:
  type: user | feedback | project | reference
---

<the fact. For feedback/project, follow with **Why:** and **How to apply:** lines.
Link related memories with [[their-name]].>
```

- **`user`** — who the user is (role, expertise, durable preferences).
- **`feedback`** — guidance on how to work (corrections and confirmed approaches);
  include the why.
- **`project`** — ongoing work, goals, constraints not derivable from the code or
  git history; convert relative dates to absolute.
- **`reference`** — pointers to external resources (URLs, dashboards, tickets).

Link related facts with `[[name]]` (the other file's `name:` slug). A link to a
not-yet-written fact is fine — it marks something worth capturing later.

**The index (`MEMORY.md`)** holds one pointer line per fact —
`- [Title](file.md) — hook` — and nothing else. Never put fact content in the index.

> Critical: keep it one-fact-per-file. Do **not** restructure into topic files or a
> single rolling log, and do **not** rebuild the index into prose — that is the
> reference dream-skill's approach, not this one.

## Consolidation rules

- **Dedupe / merge** — fold duplicate or overlapping facts into a single file;
  update the one index line.
- **Absolute dates** — replace "yesterday", "last week", "recently" with the
  absolute date.
- **Reconcile contradictions** — keep the newest true statement; delete the stale one.
- **Prune** — delete facts that are wrong or whose referenced file/function/flag no
  longer exists (verify before deleting).
- **Don't duplicate the repo** — skip anything already recorded in code, git
  history, or CLAUDE.md/AGENTS.md; capture only what was non-obvious.
- **Index sync** — every surviving fact has exactly one `MEMORY.md` pointer; remove
  lines for deleted facts.

Make the smallest set of edits that achieves the above; don't churn files whose
content is already correct.
