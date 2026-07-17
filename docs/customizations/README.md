# Customizations canon — the scope ladder iteration

Design canon for the next iteration of the `customizations` plugin (0.0.1 → 0.1.0). These documents
govern the fleet issues labeled `plugin: customizations`; where an issue and this canon disagree, the
canon wins until amended.

Status: **approved design** (brainstormed and decided 2026-07-17). The plugin as shipped implements
none of this yet; the routing table's existing `plugin`/`marketplace` rows and the
`personalMarketplace` config pointer are the seams it grows from.

## Reading order

1. [`scope-ladder.md`](./scope-ladder.md) — the four-rung home model that replaces binary
   user/project scope, the signals that steer it, and the persisted bias knob.
2. [`graduation.md`](./graduation.md) — moving a customization up the ladder: the explicit verb, the
   genericization engine, Dream-proposed candidates, and monitors as first-class cargo.
3. [`schema.md`](./schema.md) — concrete deltas to `manifest.mjs`, `config.json`, and the authoring
   references, with back-compat rules.

## The one-paragraph version

A customization's *primitive* (script, rule, hook, skill, agent, mcp, monitor…) answers "what shape
is this?"; its *rung* answers "where does it live, and who can reach it?" The rungs are: loose
project/user files → a skills-dir personal plugin (bundled, toggleable, zero ceremony) → a personal
marketplace (git + aipm: synced across machines, built for every harness) → any contributable
marketplace (distributed to others). Routing recommends a rung from signals — sharing intent,
portability need, component cohesion — under a user-configurable bias, and **graduation** is the
first-class operation that moves an existing customization up a rung, genericizing it (hardcoded
usernames, `$HOME` paths, machine assumptions → a config scheme) so it survives the trip.
