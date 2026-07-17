# Schema deltas

Concrete changes to the plugin's deterministic surfaces. Everything here is testable in
`tests/manifest.test.mjs` and the eval harness; nothing here is prose-only.

## Manifest entries (`manifest.mjs`)

**Scope generalizes to the ladder.** Today: `scope: "user" | "project"`. New:

```jsonc
{
  "scope": "project" | "user" | "personal-plugin" | "marketplace",
  // present iff scope is "personal-plugin" or "marketplace":
  "home": {
    "plugin": "<plugin-name>",            // the containing plugin
    "marketplace": "<marketplace-name>"   // rung 3/4 only; resolves via config.json `marketplaces`
  }
}
```

Back-compat rules (extending the existing missing-field defaults):

- Entries without the new values behave exactly as today; `list`/`get`/`remove` never error on old
  entries.
- `VALID_TYPES` is unchanged — the ladder is a scope axis, not new types.
- Deterministic sort order extends: user, project, personal-plugin, marketplace; then slug.

**Graduation is an entry mutation, not a new entry.** Same slug; `scope`/`home` change;
`components[]` repointed to post-move paths; a `graduated` audit field appends
`{from, to, date}` tuples. `remove` on a graduated entry lists post-move component paths (and for
rung ≥ 3, notes the marketplace deregistration step via aipm).

## `config.json` (user scope)

```jsonc
{
  "personalMarketplace": { "path": "...", "name": "..." },   // existing
  "marketplaces": { /* existing provenance registry */ },
  "scopeBias": null | "personal-plugin" | "marketplace"      // NEW — the bias knob
}
```

- `scopeBias` shifts the *no-signal default* rung only (see scope-ladder.md). Absent/null = rung 1
  default, today's behavior.
- Each `marketplaces` entry's existing `role`/`contribute` fields become load-bearing for
  graduation targeting: `role: "contributor"` ⇒ valid `--to` target; `contribute: "pr"` ⇒
  graduation ends in a branch/PR. No new fields required; validation of the combination moves into
  `manifest.mjs config` handling.

## Routing surfaces

- `SKILL.md` step 6 rewritten around the ladder + signals + bias (scope-ladder.md is normative).
- `triage.md` plugin row gains the cohesion and distribution tells; the marketplace row's
  precondition is scoped to rung ≥ 3.
- `commands/customizations.md` (+ `.toml`) gain the `graduate` subcommand.
- `evals/routing-evals.json` gains cases for: each signal → minimum rung; bias-knob default;
  bias overridden by a repo-specific signal; rung-2 Claude-only caveat when portability is the
  signal; graduation-intent prose → graduate flow; contributable-vs-read-only marketplace
  targeting; `schedule` and `incoming-changes` monitor tells. The deterministic scorer is
  unchanged.

## Delegation table

The `plugin / marketplace` row currently points at a **`marketplace-authoring` skill that does not
exist** (verified: no such skill in this repo or any installed cache — the route is a dangling
pointer). This iteration fills it with reference/authoring content owned by the customizations
plugin (`reference/authoring/plugin.md` + `reference/authoring/marketplace.md`), which:

- owns rung-2 mechanics (`claude plugin init` / manual scaffold per plugin-dev `plugin-structure`),
- owns rung-3/4 mechanics (aipm `init`/`scaffold`/`add-target`/`build`, the four marketplace
  registry files, sync = git + host auto-update),
- leans on plugin-dev's `plugin-structure`/`plugin-settings` for authoring detail rather than
  restating it, per the read-fresh convention.

If a standalone `marketplace-authoring` skill emerges later, the delegation row repoints; the
authoring references remain the plugin's own fallback (same pattern as hooks today).

## Version

This iteration is the plugin's first minor bump: `0.0.1 → 0.1.0` in `aipm.config.ts`, fanned out by
`aipm build`.
