---
name: dream
description: Consolidate memory and surface customization opportunities (memory "dream")
arguments:
  - name: mode
    description: "Optional: 'check' to only report whether a dream is due; default runs the full consolidation."
    required: false
---

Invoke the `dream` skill and run its consolidation flow, using the argument below.

Argument: `$ARGUMENTS`

- **no argument** — run the full four-phase dream: Orient (locate the memory store) →
  Gather signal (mine recent transcripts for durable facts and friction patterns) →
  Consolidate (one-fact-per-file; merge, absolutize dates, reconcile, prune; keep
  `MEMORY.md` in sync) → Propose (file `proposed` customizations via the
  `customizations` manifest for the user to review). Finish by running
  `scripts/should-dream.mjs record`.
- **`check`** — run `scripts/should-dream.mjs status` and report only whether a dream
  is due/pending; do nothing else.

Follow `skills/dream/SKILL.md` for the authoritative behavior; this command is only
the entry point.
