# ratification (schema module)

The changeset frontmatter schema, TypeScript types, and validator for the
[ratification layer](../../docs/ratification/README.md) — the seam through which agent-proposed
config changes are ratified as signed, committed changeset files.

This directory currently holds **only the schema/validator module** (issue #85). It is a
deliberate first slice: the CI validation action (issue #86) and the porcelain tool (issue #88)
both consume it as their single source of truth for "is this changeset header well-formed?"
(the first, cheapest [CI check](../../docs/ratification/ci-validation-contract.md)) rather than
each hand-rolling a parser.

## Why this isn't a full `aipm` plugin (yet)

Every other directory under `plugins/` ships an `aipm.config.ts` and is built/validated by
`aipm build`/`aipm validate` into per-host skill/hook/command artifacts — that machinery exists
for **agent-facing** surfaces. This module has no skills, hooks, commands, or agents; it's a
plain TypeScript library imported by other code (CI action, porcelain CLI). Forcing it through
the agent-plugin scaffold (empty `skills/`, `hooks/`, generated per-target manifests) would
conflate "installable agent plugin" with "shared validation library" — two different concerns —
so this directory intentionally has **no `aipm.config.ts`** and is invisible to `aipm build`/
`aipm validate` (confirmed: plugin discovery only picks up directories containing one). It lives
under `plugins/ratification/` — not a separate top-level `packages/`, since this repo is not a
multi-package pnpm workspace — to keep the product's code colocated with its
[canon](../../docs/ratification/) (`docs/ratification/frontmatter-schema.md` is the governing
spec this module implements), per this program's "each product is a plugin (or package) plus a
`docs/<project>/` canon" convention.

When #88 lands a porcelain tool with real skills/commands, that plugin will most likely `import`
from here (or this directory gains its own `aipm.config.ts` once it has agent-facing surface to
export) — revisit this note then.

## Contents

- `src/frontmatter-schema.ts` — the `zod` schema (source of truth), inferred TS types
  (`ChangesetFrontmatter`), and a JSON Schema projection (`toChangesetJsonSchema()`).
- `src/frontmatter-parser.ts` — extracts and parses a changeset file's `---`-fenced YAML header
  (strict-YAML, via the `yaml` package — the same parsing library
  `@ai-plugin-marketplace/core`'s lint engine uses for skill/agent frontmatter).
- `src/validator.ts` — `validateFrontmatter` (validate an already-parsed object) and
  `validateChangesetFile` (parse + validate a full file's text) — the single validator function
  CI and the porcelain tool both call.
- `tests/frontmatter-schema.test.ts` — spec-first structural tests; see the file's header comment
  for the acceptance-criteria-to-test mapping.

## Usage

```ts
import { validateChangesetFile } from "../../plugins/ratification/src/index.js";

const result = validateChangesetFile(fileText);
if (!result.valid) {
  // result.issues: { path, message }[] — fail closed, never best-effort.
}
```
