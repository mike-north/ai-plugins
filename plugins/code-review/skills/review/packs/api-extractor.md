---
pack: api-extractor
loads_into: [typescript, api-design]
verified: "2026-07"
sources:
  - https://api-extractor.com/
  - https://tsdoc.org/
  - https://www.semver-ts.org/
verify: "Read the repo's actual api-extractor.json (mainEntryPointFilePath, reportFolder, dtsRollup paths) — these are project-specific and commonly diverge from the defaults below."
---

# API Extractor

API Extractor validates a TypeScript library's public surface: it rolls up `.d.ts` files, requires
explicit release tags, and produces a diffable API report.

## Facts to check against

- **Missing release tags.** Every exported symbol should carry `@public`, `@beta`, `@alpha`, or
  `@internal`. An export with no tag is ambiguous about its stability contract — `@public` for
  stable committed API, `@beta` for something that may still change in a minor version, `@internal`
  for symbols exported only for cross-package use within the monorepo (excluded from the rolled-up
  `.d.ts`).
- **Internal types leaking into the public surface.** A type used only for implementation but
  exported without `@internal` invites consumers to depend on it, blocking future refactors.
- **API report diff review.** Any change to the committed `api-report/*.api.md` file should be
  read line-by-line: additions need a correct release tag; removals need a `major` changeset;
  signature changes need to be checked against the breaking/non-breaking table below.
- **Breaking vs. non-breaking signature changes.** Removing an export, renaming an export,
  reordering parameters, narrowing a type, removing an optional parameter, or making an optional
  parameter required are all breaking. Adding an optional parameter or widening a type is not.
- **`@deprecated` handling.** A deprecated item shouldn't be removed in a minor/patch release —
  only in the next major version, and only after it carried `@deprecated` with migration guidance
  for at least one prior major version.
- **Configuration correctness.** `mainEntryPointFilePath` must point at the actual compiled `.d.ts`
  entry point (not source). `reportFolder` should be committed to git (not gitignored) so the API
  report diff is reviewable. `dtsRollup.publicTrimmedFilePath` should match `package.json#types`.
- **`--local` is a local-development-only flag.** It updates the API report in place; CI should
  run `api-extractor run` (without `--local`) so a stale, un-committed report fails the build
  instead of silently passing.
