# Signal gathering — mine transcripts deterministically

Goal: extract a *small, pre-filtered* candidate set from recent session
transcripts, then reason only over that. Don't read whole transcripts into context
and eyeball them — that is expensive and unreliable. Push the search into `grep`.

## Where transcripts live

- **Claude Code:** session transcript `.jsonl` files under the project's session
  directory (e.g. `~/.claude/projects/<project-slug>/*.jsonl`).
- Other hosts: the host's session/log store. If you cannot locate transcripts,
  fall back to consolidating only what is already in the memory store and say so.

Scope to **recent** sessions (since the last dream — the `lastDream` timestamp from
`should-dream.mjs status`) so each dream processes only new material.

## Two kinds of signal

### A. Durable facts / corrections / preferences → memory

Grep for the linguistic markers of a durable statement or a correction. Examples
(case-insensitive), tuned to cut false positives:

```bash
grep -hiE "remember (that|this)|for future reference|going forward|from now on|\
always |never |i prefer|we use|our (staging|prod|production|team|convention)|\
actually,? (it|the|we|you)|no,? (it|that|the)|that's wrong|don't (do|use)" <files>
```

Each hit is a *candidate*; you decide whether it's durable (belongs in memory) or
just in-session chatter. Classify by the `type` taxonomy in
`consolidation.md` (user / feedback / project / reference).

### B. Friction patterns → proposed customizations

Friction is repetition or re-correction — the signal that a customization is
missing. Look for:

- **Repeated manual steps** — the same command/sequence run across many sessions.
- **Re-corrections** — the user correcting the *same* behavior more than once
  ("again, please…", "I told you…", a preference restated).
- **"every time / whenever / each time" + an action** — a candidate hook or rule.
- **"can you make it so…" / "I wish you would…"** — an explicit customization ask
  that was never captured.

```bash
grep -hiE "again[, ]|i (already )?(told|asked) you|every time|each time|whenever |\
can you make (it|this)|i wish you (would|could)|stop (doing|using)|please (always|stop)" <files>
```

Group hits by the behavior they're about; a behavior seen **2+ times** is a strong
candidate. For each, draft a one-line problem statement — that becomes a *proposed*
customization (see `propose.md`), which routes determinism-first to the right
primitive.

## Discipline

- Run the greps, then reason over the (small) result — never over raw transcripts.
- Prefer precision over recall: a missed candidate resurfaces next dream; a flood of
  false positives wastes the judgment budget.
- De-duplicate against the existing memory store and against already-`proposed`
  customizations (`/customizations list`) so the same item isn't raised twice.
