---
pack: sorbet
loads_into: [ruby]
verified: "2026-07"
sources:
  - https://sorbet.org/
  - https://sorbet.org/docs/tstruct
  - https://sorbet.org/docs/abstract
  - https://sorbet.org/docs/sealed
verify: "Check the file's `# typed:` sigil and the repo's srb config (sorbet/config) for the project's actual strictness baseline before flagging a gap against a stricter level than the project targets."
---

# Sorbet (Ruby type checker)

Strictness is declared per-file via a `# typed:` sigil: `false` (no checking, legacy/generated),
`true` (checks bodies, sigs optional), `strict` (sigs required on all methods), `strong` (disallows
`T.untyped`/`T.unsafe`/`T.cast` — rarely appropriate).

## Facts to check against

- **Missing `sig`.** New or changed public methods without a `sig { params(...).returns(...) }`
  declaration lose type checking entirely for that method.
- **`T.untyped` as a default.** Acceptable for genuinely dynamic data (third-party responses with
  no fixed shape) with a comment explaining why; not acceptable as a substitute for defining a
  `T::Hash[K, V]` or a `T::Struct` when the shape is actually known.
- **Unnecessary `T.unsafe`.** If a `nil?` check or `is_a?` check already narrows the type,
  Sorbet's flow-sensitive typing understands it — a following `T.unsafe(...)` is redundant and
  suppresses a real error if the check is ever removed or reordered.
- **Sigs that lie about behavior.** A `sig { returns(User) }` on a method whose body can return
  `nil` (`User.find_by` can) should be `T.nilable(User)`. A `sig` declaring `Integer` on a method
  that actually returns `Float` (integer division without `.to_f` truncation, or the reverse) is a
  latent bug the type checker won't catch because the annotation itself is wrong.
- **Redundant `T.nilable(T.nilable(X))`** — wrapping an already-nilable type again is a no-op and
  usually indicates confusion about the underlying type.
- **`T::Struct` for known-shape data** instead of an untyped hash — `const`/`prop` fields on a
  `T::Struct` subclass get individual type checking; a `T::Hash[Symbol, T.untyped]` does not.
- **`abstract!`/`sealed!` on class hierarchies.** An abstract base class should call `abstract!`
  and declare abstract methods via `sig { abstract.returns(...) }`, with overrides using
  `sig { override.returns(...) }`. A hierarchy meant to be exhaustively matched should call
  `sealed!` so `T.absurd` can verify a `case`/`when` covers every subclass.
- **`T.let` in hot paths.** `T.let` has runtime overhead under `strict`/`strong` — appropriate for
  one-time instance-variable initialization, not inside a loop body that runs on every iteration
  (a properly-`sig`'d helper method makes it unnecessary there).
