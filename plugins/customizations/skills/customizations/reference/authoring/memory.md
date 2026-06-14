# Authoring a memory (read fresh)

Memory stores a **durable, declarative fact** the agent should recall (identity, a decision, a project
fact). If the "fact" is cheaply derivable on demand, prefer a **script** over a stored value that goes
stale.

## Target resolution (in order)

1. **Native memory subsystem** — use it when the assistant has one:
   - **Claude Code:** the auto-memory directory (`…/memory/MEMORY.md` index + `memory/*.md` files).
     WebFetch `https://code.claude.com/docs/en/memory.md` for the current file layout, frontmatter,
     and import rules before writing.
   - **Codex:** `memories`. Fetch `https://developers.openai.com/codex/memories.md` fresh.
2. **Polyfill** — for a harness with **no** native memory concept, write to an `AGENTS.md` `##
   Facts` section (a portable, cross-tool convention).

## Prefer the delegate

If a memory skill is installed (`productivity:memory-management`, `anthropic-skills:consolidate-memory`),
delegate the write/consolidation to it — it handles deduping, date normalization, and indexing.

## Memory vs rule

A fact to **know** → memory. A directive to **do** → rule. Don't store imperative behavior as a "fact".
