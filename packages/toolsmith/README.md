# @mike-north/toolsmith

Deterministic lifecycle CLI for [toolsmith](https://github.com/mike-north/ai-plugins/tree/main/plugins/toolsmith)
purpose-built agent tools — the CLI backbone specified by
[`docs/toolsmith/cli-surface.md`](../../docs/toolsmith/cli-surface.md).

```
toolsmith approve <path> [--user] [--dry-run]   Promote a staged draft to live (human-run commit)
toolsmith verify [<path>] [--user]              Read-only integrity check of live hash pins
toolsmith lint <file>                           Proposal gate: lint a staged draft
toolsmith list                                  Registry inventory + drift, both scopes (markdown)
toolsmith analyze                               Mine .claude/toolsmith/history.jsonl (markdown)
```

`new`/`modify` are deliberately **not** verbs — authoring a tool draft is
agent file-editing against the toolsmith skill's skeleton; the only privileged
step in the lifecycle is `approve`, whose commit run is performed by a human
in their own terminal after reading the `--dry-run` review surface.

## Two distribution shapes, one bundle

- **npm**: `npm i -g @mike-north/toolsmith` → the `toolsmith` bin
  (`dist/toolsmith.mjs`, built on `prepack`).
- **plugin**: the identical bundle is committed at
  `plugins/toolsmith/scripts/toolsmith.mjs` so a marketplace install of the
  toolsmith plugin runs with zero build step and no `node_modules`. A test
  (`tests/dist-sync.test.ts`) keeps the committed copy byte-identical to a
  fresh build from `src/`.

After editing `src/`, run:

```bash
pnpm --filter @mike-north/toolsmith build
```

The PreToolUse hook hot path (`toolsmith-gate.sh` → `toolsmith-check.mjs`) is
deliberately **not** part of this package — it stays a thin shell prefilter +
lean node brain inside the plugin so every Bash call in every project pays
near-zero overhead (see the latency notes in `toolsmith-gate.sh`).
