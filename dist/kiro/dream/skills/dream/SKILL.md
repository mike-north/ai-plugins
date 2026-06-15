---
name: dream
description: >-
  Consolidate memory and surface customization opportunities — "dream". Use when a
  dream is pending/due at session start, or when asked to consolidate, clean up, or
  organize memory; reconcile or dedupe remembered facts; convert relative dates to
  absolute; or review accumulated learnings from recent sessions. Honors a
  one-fact-per-file memory store and proposes (never auto-creates) customizations.
arguments:
  - name: mode
    description: "Optional: 'check' to only report whether a dream is due; default runs the full consolidation."
    required: false
---

# Dream — memory consolidation & self-improvement

Dreaming is periodic memory consolidation, modeled on what the brain does during
sleep: review what accumulated, keep what matters, reconcile contradictions, and
notice patterns worth acting on. It runs **at most once per interval** (default 24h)
and is deterministic where it can be — the agent never computes elapsed time or
hand-rolls bookkeeping; a script does (`scripts/should-dream.mjs`).

Two things happen each dream: (1) the **memory store** is consolidated, and (2)
recurring **friction** is turned into *proposed* customizations for you to review.
Dreaming never self-authors customizations or silently rewrites your guidance.

## When it runs

- **Manually:** you invoke `/dream`.
- **Automatically:** a turn-end hook (`Stop` on Claude and Codex, `AfterAgent` on
  Gemini) queues a dream when the interval has elapsed (drops a `.dream-pending` flag);
  the **auto-dream rule** consumes that flag at the next session start and invokes this
  skill (launching the skill is always root guidance — a hook can't run it). A host with
  no hooks at all relies on the rule alone. See `reference/scheduling.md`.

If invoked with `check`, run `scripts/should-dream.mjs status` and report whether a
dream is due — do nothing else.

## Procedure

Work the four phases in order. Read the referenced doc for each phase before acting;
don't reconstruct the format from memory.

### 1. Orient

Locate the active memory store (read `reference/consolidation.md` for resolution):
1. **Native** memory subsystem — Claude's auto-memory dir (`…/memory/MEMORY.md` +
   `memory/*.md`), Codex `memories`.
2. **Polyfill** — an `AGENTS.md` `## Facts` section where there is no native store.

Read the index (`MEMORY.md`) and skim what already exists so consolidation merges
into it rather than duplicating.

### 2. Gather signal

Scan recent session transcripts for two kinds of signal (see
`reference/signal-gathering.md` for the deterministic grep recipes):
- **Durable facts / corrections / preferences** — things true beyond this session
  that belong in memory.
- **Friction patterns** — repeated manual steps, re-corrections, or "you keep doing
  X wrong" moments that imply a missing customization (a hook, rule, skill, …).

Prefer the scripted extraction; reason only over the small, pre-filtered result.

### 3. Consolidate (one-fact-per-file)

Update the memory store per `reference/consolidation.md`:
- **One fact per file** with the required frontmatter; **do not** restructure into
  topic files or a monolithic log.
- Merge duplicates, **convert relative dates to absolute**, resolve contradictions
  (keep the newest true statement), and drop references to things that no longer
  exist.
- Keep the `MEMORY.md` index in sync — one pointer line per fact.

### 4. Propose customizations

For each friction pattern, append a **`proposed`** customization entry via the
`customizations` plugin's manifest (read `reference/propose.md` for the exact shape
and command). You **propose**; the user reviews with `/customizations list` and
approves before anything is authored. If the `customizations` plugin is not present,
note the opportunities in your summary and skip the manifest write (degrade to
memory-only).

### Finish

Run `scripts/should-dream.mjs record` to stamp the completion time and clear the
pending flag. Summarize what you consolidated and what you proposed.

## Determinism note

`scripts/should-dream.mjs` owns all timing/bookkeeping (`tick` / `status` / `record`
/ `clear`); the skill spends reasoning only on the irreducible judgment — what is
worth remembering and what friction is worth fixing.
