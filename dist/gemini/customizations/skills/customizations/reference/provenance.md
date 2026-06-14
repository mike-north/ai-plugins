# Provenance & edit-policy

Skills and plugins are often **imported from a marketplace**. The router must never silently edit
content the user merely *consumes* — that diverges from upstream and gets clobbered on auto-update.
The rule: **know where an artifact came from, and what you're allowed to do to it.**

## Per-marketplace policy (deterministic lookup)

Track policy **per marketplace**, not per artifact, in the plugin's `config.json` (user scope):

```jsonc
{
  "marketplaces": {
    "anthropics/skills":  { "role": "consumer",    "contribute": "none" },
    "ai-plugin-marketplace/tools": { "role": "consumer", "contribute": "none" },
    "myorg/team-plugins": { "role": "contributor", "contribute": "pr"   }
  }
}
```

- **role**
  - `consumer` — read-only. You install and use it; you do not edit it.
  - `contributor` — editable. You (co-)maintain it; edits to its source are expected.
- **contribute** — how edits flow back for a `contributor` marketplace: `pr` (open a pull request),
  `direct` (commit/push directly), or `none`.

Imported customizations record their `origin` (the marketplace name) in the manifest; policy is
inherited from the marketplace. A locally authored customization has `origin: null` and is freely
editable.

## Decision: before modifying an existing skill/plugin

1. **Resolve origin.** Is the target traceable to a marketplace (e.g. it lives under a plugin cache
   like `~/.claude/plugins/cache/<owner>/...`, or its manifest entry has an `origin`)?
2. **Look up policy** for that marketplace in `config.json`.
3. **Act:**
   - `consumer` → **never edit in place.** Create a **personal override** — a local skill/rule that
     supplements or shadows the upstream artifact at a higher-priority scope (e.g. a user-scope skill
     that extends or replaces behavior). Record it as a *new* local customization (`origin: null`).
   - `contributor` → **edit the source**, then honor `contribute`: with `pr`, finish by offering to
     open a pull request (tie into the user's PR workflow); with `direct`, commit; with `none`, just
     edit.
   - **Unknown / ambiguous origin** → **ask the user** which it is, and offer to record the policy in
     `config.json` so future decisions are deterministic.

## Why this matters

- Editing a `consumer` artifact (e.g. an Anthropic official Claude skill) makes taking upstream
  updates painful and risks your change being overwritten on auto-update.
- A `contributor` marketplace (e.g. a team marketplace you maintain) is the opposite — editing there
  and pushing a PR is often the *intended* outcome of a customization session.
- Recording policy once, per marketplace, keeps the call **deterministic** instead of re-litigated
  every time (Axis 1 applied to the router's own decisions).
