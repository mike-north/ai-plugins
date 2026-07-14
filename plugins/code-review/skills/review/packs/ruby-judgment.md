---
pack: ruby-judgment
loads_into: [ruby]
verified: "2026-07"
sources:
  - https://rubystyle.guide/#no-explicit-return
  - https://sorbet.org/docs/type-assertions
  - https://guides.rubyonrails.org/active_record_querying.html#counter-caches
verify: "Check the repo's own rubocop.yml (Style/RedundantReturn, etc.) for the project's actual return-style convention before flagging a deviation."
---

# Ruby judgment (beyond idioms/Sorbet sigs/Rails patterns already covered)

## Facts to check against

- **Explicit `return` on the last line of a method body.** Ruby convention favors the implicit
  return of the last evaluated expression — `def calculate(x); result = x * 2; return result;
  end` should drop the `return`. Explicit `return` is still idiomatic for early exits
  (`return 0 if x.nil?`) — only the trailing, unconditional `return` is the smell.
- **`T.cast`/`T.let` used where Sorbet would already infer or narrow the type.** `T.cast(value,
  SomeType)` performs no runtime check — it's a compile-time-only assertion that silently lies if
  wrong. Reach for it only when Sorbet genuinely cannot infer a type it should be able to trust
  (e.g., after a JSON parse); if a preceding `is_a?`/`nil?` check already narrows the type,
  wrapping the result in `T.cast`/`T.unsafe` is both redundant and removes the safety net if the
  check is later reordered or deleted.
- **A `scope` that can return `nil` instead of a relation.** `scope :recent, -> { where(...) if
  some_condition }` returns `nil` when `some_condition` is false, which breaks chaining
  (`Model.recent.where(...)` raises `NoMethodError` on `nil`) — a scope must always return a
  relation; move the conditional into a class method (`def self.recent_if(cond); cond ? recent :
  all; end`) instead.
- **N+1 avoided with `includes`/`preload` where a `counter_cache` would be cheaper.** For the
  common case of just needing a count (`user.posts.count` in a loop), a `counter_cache: true`
  association plus a `posts_count` column avoids the query entirely rather than merely batching it
  — reach for `includes` when the associated records themselves are needed, `counter_cache` when
  only the count is.
