---
pack: code-quality-judgment
loads_into: [generalist]
verified: "2026-07"
sources:
  - https://refactoring.guru/smells/long-method
  - https://en.wikipedia.org/wiki/Cyclomatic_complexity
verify: "Complexity thresholds (nesting depth, function length) are heuristics, not hard rules — check whether the repo's own linter (eslint complexity/max-lines-per-function, etc.) already enforces different numbers before citing these."
---

# Code quality judgment: naming/clarity, complexity smells, complexity placement

## Facts to check against

- **Misleading names.** A function whose name promises one thing but does another
  (`getUserId()` that also creates a user as a side effect) is worse than no documentation — a
  caller trusts the name and gets surprised by the side effect. Flag names that require "and" to
  describe accurately (`validateAndSaveAndNotify`) — that's usually a sign the function should be
  split, or at minimum renamed to disclose everything it does.
- **Magic numbers/strings standing in for a named concept.** `if (status === 3)` forces every
  reader to go find what `3` means; `if (status === Status.Completed)` doesn't. This is
  independent of whether the codebase uses a real enum or just a well-named constant — the bar is
  "does the comparison read as a concept," not "is it type-safe."
- **Inconsistent naming for the same concept across a codebase.** `user_id`, `userId`, and `uid`
  referring to the same field in different modules forces readers to mentally alias them and makes
  a global search for usages incomplete. Flag new code introducing a third variant of an
  already-established name.
- **Complexity smells worth a second look, not automatic rejection**: nesting deeper than
  3–4 levels of `if`/`for`/`try` (an early-return or extracted-function usually flattens it);
  functions materially longer than the codebase's own typical function length (no fixed number —
  compare to siblings in the same file/module); callback pyramids that a promise chain or
  `async`/`await` would flatten; and "clever" one-liners (dense chained combinators, bit tricks)
  that trade a few lines for meaningfully harder comprehension without a performance reason.
- **Complexity that belongs in a library but lives in the application layer.** When application
  code manually orchestrates several calls into the same library in the same order every time it's
  used (`const raw = parser.readFile(path); const validated = parser.validate(raw, schema); const
  resolved = parser.resolveReferences(validated);` repeated at every call site), that sequence
  belongs behind a single library entry point (`loadConfig(path, schema)`), not repeated at each
  call site — every call site is a chance to get the order wrong or skip a step. This does **not**
  apply when: the application genuinely needs fine-grained control over individual steps, the
  library's stated purpose is to be a toolkit of composable primitives (e.g. a general-purpose
  utility library, not a purpose-built config loader), or absorbing the sequence would force the
  library to take an opinion on something outside its domain (e.g. a JSON parser deciding how
  validation errors should be logged).
