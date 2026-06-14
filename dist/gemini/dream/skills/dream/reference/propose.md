# Propose customizations (the customizations seam)

Each friction pattern from `signal-gathering.md` becomes a **proposed** entry in the
`customizations` plugin's manifest. You only *propose*; the user reviews with
`/customizations list` and approves before anything is authored. This matches the
propose → approval → never-self-modify discipline — dreaming must not author
customizations or edit guidance on its own.

## Find the customizations manifest

The `customizations` plugin ships the manifest engine at:

```
<customizations-plugin-root>/skills/customizations/scripts/manifest.mjs
```

Locate it (it is an install-on-demand dependency). If it is **not** installed:
- Offer to install the `customizations` plugin (it unlocks the propose step), and
- meanwhile **degrade gracefully**: list the opportunities in your dream summary and
  skip the manifest writes. Do not invent another tracking file.

## The proposed-entry shape

A proposed customization carries no artifacts yet (nothing has been authored) — it
records the *opportunity* and a suggested primitive. `created` defaults if omitted.

```jsonc
{
  "slug": "format-on-save-pipeline",          // short, kebab-case, unique
  "type": "hook",                             // your best guess at the primitive
  "description": "Re-corrected formatting 3× this week — every save should run the fixed prettier+eslint pipeline. Candidate: hook (agent's own edit) or format-on-save script.",
  "scope": "project",                         // user | project
  "status": "proposed",                       // REQUIRED — this is a proposal
  "origin": null,                             // locally surfaced, not from a marketplace
  "components": []                            // empty: nothing authored yet
}
```

Guidance:
- **`type`** is a hint, not a commitment — `/customizations` re-runs the full
  determinism-first triage when the user approves. Pick the primitive you'd route to,
  but phrase `description` so the real routing isn't pre-empted.
- **`description`** should state the *evidence* (what recurred, how often) and the
  *suggested* fix, so the user can judge it cold.
- **`scope`** is your recommendation; the user confirms on approval.

## Write it

Pipe the JSON to the manifest's `add` (stdin), once per proposal:

```bash
echo '<entry-json>' | node "<path>/manifest.mjs" add
```

`add` validates the shape, applies defaults (`created`, `assistant`, `status`), and
writes `<slug>.json` into the customizations store (`~/.claude/customizations` for
`user` scope, `./.claude/customizations` for `project`; override via
`CUSTOMIZATIONS_HOME` / `CUSTOMIZATIONS_PROJECT_DIR`). It refuses to clobber an
existing slug without `--force` — so re-running a dream won't duplicate a proposal
already on file (choose a stable slug derived from the behavior).

After writing, mention in your summary how many proposals you filed and that the user
can review them with `/customizations list --status proposed`.
