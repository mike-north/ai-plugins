# Authoring a rule / guidance (read fresh)

A rule is a **standing directive** applied with judgment, broadly across situations
("always/never/prefer…", a convention/policy). It tolerates being a soft nudge. If the directive must
be **guaranteed** and is mechanically enforceable → use a **hook** instead.

## Before authoring — read the canonical docs LIVE

- **Claude Code:** rules live as instruction content (CLAUDE.md and/or rule files). WebFetch
  `https://code.claude.com/docs/en/memory.md` (instruction files + imports) and
  `https://code.claude.com/docs/en/settings.md` for the current locations and precedence.
- **Cursor:** project/user rules as `.mdc` files — fetch Cursor's current rules doc fresh.
- **Codex / others:** `AGENTS.md` directives — fetch the host's current convention.

## Keep rules lean

Too much always-in-context guidance dilutes attention and can conflict. Prefer one crisp directive;
if it's a multi-step *procedure* rather than a constraint, it's a **skill**, not a rule. If you need
it toggleable per session/subagent, that's also a **skill** (rules can't be conditionally enabled).

## Scope

Repo-specific convention → project. Personal cross-project preference → user/global. Always confirm.
