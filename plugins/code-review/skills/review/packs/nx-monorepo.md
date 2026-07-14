---
pack: nx-monorepo
loads_into: [typescript]
verified: "2026-07"
sources:
  - https://nx.dev/core-features/enforce-module-boundaries
  - https://nx.dev/concepts/task-pipeline-configuration
  - https://nx.dev/ci/features/affected
verify: "Check the repo's actual nx.json targetDefaults and .eslintrc module-boundary config before assuming a default Nx setup — many workspaces customize both heavily."
---

# Nx (monorepo build system)

Nx derives a project graph from imports and `project.json` metadata, using it for incremental
builds, caching, and affected-project detection.

## Facts to check against

- **Module boundaries.** `@nx/enforce-module-boundaries` (ESLint rule) with `depConstraints`
  enforces which project `tags` (e.g. `type:feature`, `type:data-access`, `scope:checkout`) may
  depend on which others. A new project with no tags, or an import that crosses a boundary the
  `depConstraints` forbid, defeats the whole system — check that new projects carry appropriate
  tags and that new imports respect existing constraints.
- **`project.json` target completeness.** A target missing `outputs` won't have its artifacts
  cached. A target missing `inputs` (or not inheriting sane ones from `targetDefaults`) can produce
  a stale cache hit after a config change that should have invalidated it. A `build` target missing
  `dependsOn: ["^build"]` may run before its dependencies are actually built.
- **`nx affected` in CI, not `run-many --all`.** CI that runs `nx run-many -t build --all` on
  every commit ignores Nx's whole reason for existing — verify CI uses `nx affected -t <target>
  --base=<ref>` with a real base ref (typically the merge-base with the default branch).
- **Cache input completeness.** Environment files, framework config files (`webpack.config.js`,
  `vite.config.ts`), and other build-affecting inputs not listed in a target's `inputs` mean a
  change to them won't invalidate the cache — a stale build could be served.
- **Implicit dependencies.** A project that depends on another without importing its code (an E2E
  app testing a separate serve target, a project reading workspace-root config) needs
  `implicitDependencies` declared in `project.json`, or Nx's affected-detection won't know about
  the relationship.
- **`targetDefaults` over per-project duplication.** The same `inputs`/`outputs`/`dependsOn`
  repeated across many `project.json` files should usually live once in `nx.json#targetDefaults`.
- **Custom generators** that create a new project should call `addProjectConfiguration` (or
  `updateProjectConfiguration` for existing ones) so the project actually enters the graph with
  correct targets and tags — a generator that only writes files without registering the project
  configuration silently breaks caching/boundaries for that project.
