---
pack: changesets
loads_into: [typescript]
verified: "2026-07"
sources:
  - https://github.com/changesets/changesets
  - https://semver.org/
  - https://www.semver-ts.org/
verify: "Check the repo's actual .changeset/config.json for a custom changelog generator or pre-1.0 semver policy before applying the defaults below."
---

# Changesets (monorepo versioning)

A changeset (`.changeset/*.md`) describes a pending release: which packages bump, by how much,
and what the changelog entry should say.

## Facts to check against

- **Presence.** A PR that changes a package's public API (exported functions/types/components,
  or documented behavior) needs a changeset. Internal-only changes — tests, docs, build config,
  CI, internal refactors with no consumer-visible effect — don't.
- **Semver bump correctness.** `major` for anything that breaks existing consumer code (removed
  or renamed export, new required parameter, narrowed type, removed `@deprecated` item). `minor`
  for additive, backwards-compatible changes (new export, new optional parameter, widened type).
  `patch` for bug fixes and internal changes with no API impact.
- **TypeScript-specific semver.** Narrowing a type (`string | null` → `string`, or `foo?: string`
  → `foo: string`) is breaking (major). Widening (`foo: string` → `foo?: string`, or `string` →
  `string | number`) is additive (minor). `foo: any` → `foo: unknown` is breaking for consumers
  who relied on the lack of type-checking; the reverse is not.
- **Umbrella-package inclusion.** If the repo has both a scoped package (`@scope/core`) and an
  unscoped umbrella package that re-exports it, and the umbrella's `index.ts` actually re-exports
  the changed symbol, the umbrella package must be listed in the same changeset — check the
  umbrella's entry point for `export * from '@scope/core'` (or an explicit re-export) to confirm.
- **Changelog quality.** The description should read from a consumer's perspective ("what does
  this mean for someone using this library"), not implementation detail ("refactor parser
  internals"). Breaking changes should include migration guidance in the same changeset.
- **Grouping.** Multiple `.changeset/*.md` files describing pieces of the same logical feature
  should usually be one changeset; changes to genuinely independent packages that could ship
  separately can stay as separate changesets.
- **Pre-1.0 packages.** Some projects treat `0.x` versions with relaxed semver (breaking changes
  as `minor`) — check `.changeset/config.json` or the project's stated convention rather than
  assuming standard semver applies below `1.0.0`.
