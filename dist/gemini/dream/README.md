# Dream

Periodic **memory consolidation and self-improvement**, modeled on what the brain
does during sleep. Once per interval (default 24h), the `dream` skill reviews recent
sessions, consolidates your memory store, and surfaces recurring friction as
**proposed** customizations for you to review.

Modernized from [`grandamenium/dream-skill`](https://github.com/grandamenium/dream-skill)
and wired into the `customizations` plugin.

## What a dream does (four phases)

1. **Orient** — locate the active memory store (native memory subsystem, or an
   `AGENTS.md ## Facts` polyfill).
2. **Gather signal** — deterministically mine recent transcripts for durable facts /
   corrections / preferences, and for **friction patterns** (repeated manual steps,
   re-corrections) that imply a missing customization.
3. **Consolidate** — update the store **one fact per file**: merge duplicates, convert
   relative dates to absolute, reconcile contradictions, prune stale facts, and keep
   the `MEMORY.md` index in sync. (It does **not** restructure into topic files.)
4. **Propose** — file recurring friction as `proposed` customizations via the
   `customizations` plugin; you review with `/customizations list` and approve.
   Dreaming never self-authors customizations.

## Usage

```text
/dream          # run a full consolidation now
/dream check    # report only whether a dream is due
```

## Automatic dreaming

Dreaming is split into a deterministic **scheduler** (`skills/dream/scripts/should-dream.mjs`)
and the agentic **runner** (the `/dream` skill):

- **Queue (deterministic, via a hook)** — a session-end/turn-end hook runs
  `should-dream.mjs tick`, dropping a `~/.claude/.dream-pending` flag when the interval has
  elapsed. This ships for every host with hooks: Claude `Stop`, Codex `Stop`, Gemini
  `AfterAgent` — built from one `hooks/claude.yaml` source.
- **Launch (agentic, via root guidance)** — a session-start instruction runs `/dream check`
  and launches a full `/dream` when one is due. A hook can't run an agentic skill, so this
  step is always root guidance, on every host. It's also the complete fallback on a host that
  has no hooks at all.

The launch instruction ships as `steering/auto-dream.md` (auto-loaded by Kiro) and in
`GEMINI.md` (auto-loaded by Gemini CLI). On hosts whose root guidance a plugin can't populate
automatically, add the snippet yourself:

**Claude Code** — add to your `CLAUDE.md`:

```markdown
## Auto Dream
At session start, run `/dream check`; if a dream is due or pending, run `/dream`.
```

**Codex** — add to your `AGENTS.md` (Codex's Stop hook handles queuing; this launches it):

```markdown
## Auto Dream
At session start, run `/dream check`; if a dream is due or pending, run `/dream`.
```

Tune the cadence with `DREAM_INTERVAL_HOURS` (default `24`) and the state directory
with `DREAM_HOME` (default `~/.claude`).

## Dependency

The **Propose** phase records `proposed` customizations through the `customizations`
plugin's manifest. Install `customizations` to unlock it; without it, dreaming still
consolidates memory and lists the opportunities in its summary.

## License

ISC
