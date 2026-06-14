# Auto-dream — session-start trigger

At the **start of each session**, check whether a memory-consolidation "dream" is
due, and run one if so:

1. Run the dream skill's gate in check mode — `/dream check` (which runs
   `should-dream.mjs status`). It reports `due` / `pending`.
2. If a dream is **pending or due**, run a full **`/dream`** now, before other work,
   unless the user has an urgent task in flight (then offer to dream afterward).
3. If neither, do nothing — this is a ~10ms no-op.

This is the portable trigger: it works on any host that loads always-on guidance,
including hosts with no hook system. Where hooks exist, a session-end hook also
pre-queues the dream by dropping `~/.claude/.dream-pending`; this rule is what
actually launches `/dream`.

Dreaming is at most once per interval (default 24h), so this check is cheap and
rarely fires.
