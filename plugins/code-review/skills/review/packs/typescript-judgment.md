---
pack: typescript-judgment
loads_into: [typescript]
verified: "2026-07"
sources:
  - https://zod.dev/
  - https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html#optional-variance-annotations-for-type-parameters
  - https://nodejs.org/api/packages.html#dual-package-hazard
verify: "Check the repo's actual TypeScript version (variance annotations need 4.7+) and whether zod/a schema library is a dependency before flagging its absence."
---

# TypeScript judgment (beyond type-checker mechanics)

## Facts to check against

- **Zod (or similar) schemas defined inline instead of at module scope.** A schema built inside a
  function body (`function handle(x: unknown) { const schema = z.object({...}); ... }`) is
  reconstructed on every call — no caching, wasted allocation on hot paths. Hoist to a named
  `const` at module scope; the schema itself doesn't change between calls.
- **Type guards accepting `unknown` that don't validate the full contract they claim.** A guard
  typed `(value: unknown) => value is Record<string, unknown>` is a promise to validate *any*
  value, not just the shapes the guard happens to be called with today. A check of only
  `typeof value === 'object' && value !== null` passes arrays, wrapped primitives (`Object(10n)`),
  class instances, and symbol-keyed objects. The full contract needs `!Array.isArray(value)`,
  `Object.getPrototypeOf(value) === Object.prototype` (rejects class instances and wrapped
  primitives), and `Object.getOwnPropertySymbols(value).length === 0` (rejects symbol-keyed
  objects). Nested fields need the same rigor applied recursively, not a shallow check.
- **Branded types using a string-keyed brand.** `type Integer = number & { readonly __brand:
  "Integer" }` pollutes autocomplete — every consumer typing `.` after an `Integer` sees `__brand`
  in the suggestion list. A `unique symbol` brand (`declare const __brand: unique symbol; type
  Integer = number & { readonly [__brand]: "Integer" }`) is invisible to IDE autocomplete and has
  zero runtime cost since the symbol is never exported or instantiated.
- **Missing variance annotations on generic interfaces (TS 4.7+).** A generic interface with only
  a getter (`interface Box<T> { get value(): T }`) is structurally covariant, but TypeScript
  can't always infer that without help in complex positions — an explicit `interface Box<out T>`
  documents the intent and can resolve otherwise-invalid variance in recursive or mutually
  referential generic types. `in T` marks a contravariant (setter-only) position. Absence isn't
  always wrong, but a generic type with unexpected variance errors is a signal to check whether an
  explicit annotation is warranted.
- **Dual package hazard.** A library shipping both `main` (CJS) and `module`/`exports.import`
  (ESM) entry points can end up loaded twice under different module identities if a consumer's
  bundler resolves one copy via `require` and another via `import` — singletons, `instanceof`
  checks, and module-level state silently break because the two copies don't share state. Check
  that `package.json#exports` declares a single, conditional-exports-correct entry per module
  specifier (`{"import": "...", "require": "..."}` pointing at outputs built from the same source)
  rather than independently-maintained ESM/CJS builds that can drift.
