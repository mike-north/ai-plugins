# The scope ladder

## Problem

The router's scope step (routing flow step 6) is binary: user (`~/.claude/`) or project
(`<repo>/.claude/`). Two things have changed since that was designed. Personal plugin marketplaces
became the established way to make harness components portable — across harnesses (one source,
aipm-built for Claude/Cursor/Codex/Gemini) and across machines (git + the host's marketplace
auto-update). And the plugin primitive's only routing tell is toggleability, so the router never
recommends a plugin for the two reasons people actually build them: **cohesion** (a skill that
depends on an agent existing, or vice versa) and **distribution** (a teammate might want this).

Meanwhile a fourth home exists that the plugin has never modeled (verified against current Claude
Code docs): `claude plugin init <name>` scaffolds a plugin into `~/.claude/skills/<name>/` that
auto-loads as `<name>@skills-dir` — a real plugin (manifest, component bundling, `/plugin` UI
toggling) with **no marketplace and no git**. Related loading paths: `--plugin-dir` (session-only)
and local-path marketplaces (persistent, directory-only).

## The ladder

| Rung | Home | Adds | Harness reach |
|---|---|---|---|
| 1a | project — `<repo>/.claude/` | repo-local | host-native |
| 1b | user — `~/.claude/` loose files | personal, this machine | host-native |
| 2 | personal plugin — `~/.claude/skills/<name>/` (`@skills-dir`) | bundling + toggle-as-unit, zero ceremony | **Claude Code only** |
| 3 | personal marketplace — git repo + aipm | cross-machine sync, cross-harness builds, versioning | claude/cursor/codex/gemini via aipm |
| 4 | contributable marketplace — shared repo, contributor role | distribution to others | same as 3 |

Each rung adds exactly one capability over the previous. The ladder is a *home* dimension,
orthogonal to the primitive dimension: any primitive can live at any rung (with the monitor and
harness caveats below). "Scope" in the manifest generalizes from `user|project` to a rung
(see `schema.md`).

Invariants:

- **Rung 2 is Claude-only.** When the driving signal is portability (other harnesses, other
  machines), the router must say so and recommend rung 3, not 2. Rung 2's honest pitch is "the
  enableable/disableable unit, without ceremony."
- **Rung 4 is defined by editability, not team-ness.** A contributable marketplace is any
  marketplace the user can edit or contribute to. Read-only marketplaces (e.g. the official
  Anthropic marketplace) are never graduation targets. The existing provenance model governs:
  `role: contributor` qualifies; `contribute: pr` means changes land as a branch/PR, never a direct
  push; `role: consumer` disqualifies (the personal-override rule applies instead).
- **The marketplace-first precondition weakens.** Today "plugin with no known marketplace → route to
  `marketplace` first." Under the ladder, rung 2 needs no marketplace at all — the precondition
  applies only when the *recommended rung* is ≥ 3. This deliberately lowers the barrier to the
  plugin primitive.

## Signals (routing step 6 rewrite)

Detection stays where it is cheap — in the prose of the user's ask and the facts of the manifest.
The router recommends the **lowest rung that satisfies every detected signal**, states which signals
fired, and confirms with the user:

| Signal | Tell (examples, not exhaustive) | Minimum rung |
|---|---|---|
| Cohesion | component depends on another component ("the skill calls the agent"); one logical unit spans primitives | 2 |
| Toggleability | "turn this off for X", per-context enablement (existing tell) | 2 |
| Portability | "on my other machine", "in Codex too", multi-harness intent | 3 |
| Sharing | "my teammate", "we", "our team", any second person who'd run it | 4 (or 3 when the target is the personal marketplace others consume) |
| None of the above | — | 1 (as today) |

No signal is ever a silent default to a higher rung: higher rungs cost ceremony (git, build,
re-install latency), and recommending them without cause erodes trust in the router.

## The bias knob

Some users operate marketplace-first — everything portable by default. A persisted preference in the
user-scope `config.json` (see `schema.md` for the key) shifts the *no-signal default* from rung 1 to
the configured rung. Signals still override in both directions (a repo-specific hook stays project
scope even under a marketplace bias; the router says why). The knob is set explicitly by the user or
offered by the router after it observes repeated manual escalations — never flipped silently.

## Prerequisite checks per rung

- Rung 2: none (Claude Code ≥ the version shipping `claude plugin init`; degrade: create the
  directory + manifest by hand per plugin-dev `plugin-structure`).
- Rung 3: a known personal marketplace (`config.json` `personalMarketplace`); if absent, the
  marketplace-first flow creates one (aipm `init`), which is itself a tracked customization of type
  `marketplace`.
- Rung 4: a `marketplaces` registry entry with an editable role; contribution mode read from
  provenance (`pr` vs `direct`).

## Non-goals

- No new harness-support claims: the ladder does not make monitors or any other laggard primitive
  portable by itself; per-primitive caveats stay in the authoring references.
- No marketplace hosting/discovery features (multi-user browsing, ratings, catalogs). Out of scope,
  same as the toolsmith canon's deferral of multi-user problems.
- No automatic rung migration without an explicit user yes (see `graduation.md` — even
  Dream-proposed graduations are `proposed` until approved).
