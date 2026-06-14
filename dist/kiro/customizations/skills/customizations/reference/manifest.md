# Manifest & config schema

Tracked customizations are recorded as **one JSON file per customization**, managed *deterministically*
by `scripts/manifest.mjs` (the agent never hand-edits these — it calls the script). This is the
successor to the legacy `~/.claude/customizations/*.json` files.

## Locations (by scope)

- **user scope** → `~/.claude/customizations/` (override base with `CUSTOMIZATIONS_HOME`)
- **project scope** → `<repo>/.claude/customizations/` (override with `CUSTOMIZATIONS_PROJECT_DIR`)

A single `config.json` lives in the **user** dir (see below). It is plugin config, **not** a
customization entry — listings exclude it.

## Customization entry (`<slug>.json`)

```jsonc
{
  "slug": "git-utilities",                 // kebab-case, ^[a-z][a-z0-9-]*$ ; the filename stem
  "type": "script|memory|rule|hook|skill|agent|mcp|monitor|plugin|marketplace",
  "description": "one line",
  "scope": "user|project",
  "assistant": "claude",                    // default "claude"
  "status": "active",                        // "proposed" | "active"  (default "active")
  "origin": null,                            // null = locally authored; else a marketplace name (→ provenance.md)
  "created": "2026-06-13T17:00:00Z",        // ISO 8601
  "components": [
    { "path": "~/.claude/skills/git/SKILL.md", "action": "created|modified", "description": "…" }
  ]
}
```

- **One logical customization = one entry**, even when it spans several files (e.g. a skill + the two
  scripts that arm it — list all under `components`).
- **Backward compatibility:** legacy files lack `type`/`status`/`origin`. Readers treat missing
  `status` as `active`, missing `type` as `unknown`, missing `origin` as `null`, and never rewrite a
  legacy file unless an explicit mutation targets it.

## `config.json` (user dir)

```jsonc
{
  "personalMarketplace": { "path": "/abs/path/to/repo", "name": "my-plugins" },
  "marketplaces": {
    "anthropics/skills":  { "role": "consumer",    "contribute": "none" },
    "myorg/team-plugins": { "role": "contributor", "contribute": "pr"   }
  }
}
```

- `personalMarketplace` — where the plugin path scaffolds plugins (`aipm`). Remembered, not
  auto-discovered.
- `marketplaces` — the provenance/edit-policy registry (see `provenance.md`).

## `status` lifecycle and the Dream seam

- `active` — a real, in-effect customization.
- `proposed` — a *suggestion* not yet authored. The seam for a future **Dream** plugin: Dream
  appends `proposed` entries discovered from session transcripts; the user reviews them with
  `/customizations list`, approves, and the router authors them and flips `status` to `active`.
- **Never author a `proposed` entry's artifacts without explicit user approval** (propose → approval
  → never self-modify).

## Helper script surface (`../scripts/manifest.mjs`)

`add` (from `--file` or stdin), `list [--scope][--status][--type][--json]`, `get <slug>`,
`remove <slug>` (deletes the entry only and prints its `components` so the caller can clean up the
artifacts), and `config get|set` (dotted keys). All scopes honor the env overrides above. Run with
no subcommand to print usage.
