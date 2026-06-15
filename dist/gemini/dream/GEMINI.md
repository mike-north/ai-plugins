# Dream

Periodic **memory consolidation and self-improvement**, modeled on sleep. Once per
interval (default 24h), the `dream` skill reviews recent sessions, consolidates the
memory store (one fact per file), and surfaces recurring friction as **proposed**
customizations for you to review.

## Usage

- `/dream` — run a full consolidation now.
- `/dream check` — report only whether a dream is due.

See `skills/dream/SKILL.md` for the four-phase procedure (Orient → Gather signal →
Consolidate → Propose).

## Auto-dream (session start)

At the **start of each session**, run `/dream check`. If it reports a dream is
**due or pending**, run a full `/dream` before other work (unless the user has an
urgent task in flight). Dreaming is at most once per ~24h, so this is almost always a
fast no-op. Where hooks are available, a session-end hook (`AfterAgent`) also
pre-queues a due dream; this session-start check is what launches it.
