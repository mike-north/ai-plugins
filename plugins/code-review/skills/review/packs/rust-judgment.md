---
pack: rust-judgment
loads_into: [rust]
verified: "2026-07"
sources:
  - https://rust-lang.github.io/api-guidelines/naming.html
  - https://rust-lang.github.io/api-guidelines/predictability.html
  - https://rust-lang.github.io/api-guidelines/future-proofing.html
verify: "Check the crate's existing method-naming patterns for consistency before flagging a single instance — some conventions are established per-crate rather than universal."
---

# Rust API Guidelines: naming and shape (beyond soundness/async)

## Facts to check against

- **Conversion method naming (C-CONV).** `as_foo` should be a cheap, non-allocating
  reference-to-reference conversion (`&str` from `&Path`). `to_foo` should be an expensive or
  allocating conversion (`&str` → `String`). `into_foo` should consume `self`. A method named
  `to_iter()` that consumes `self` is misnamed — it should be `into_iter()`; a method named
  `as_string()` that allocates is misnamed — it should be `to_string()`.
- **Iterator producer naming (C-ITER).** Types with a natural iteration order should expose
  `iter()` (borrowing), `iter_mut()` (mutable borrow), and `into_iter()` (consuming) — not
  ad hoc names like `entries()` or `items()` unless the crate's convention already establishes
  those consistently.
- **No out-parameters (C-NO-OUT).** A function taking `&mut T` purely to write a second return
  value (`fn compute(&self, out: &mut Vec<u8>)`) should return a tuple or struct instead
  (`fn compute(&self) -> (Output, Vec<u8>)`) — out-parameters obscure the function's actual return
  shape at the call site and don't compose with `?`/combinators.
- **Argument validation at the boundary (C-VALIDATE).** Constructors and setters should reject
  invalid input immediately (`Port::new(n: u16)` — the type system already bounds it; a `fn
  new(n: u32) -> Result<Port, Error>` that defers the range check to first use lets an invalid
  value flow through the system before failing, producing a confusing error far from its cause.
- **`Deref`/`DerefMut` used for inheritance-like access (C-DEREF).** Implementing `Deref` on a
  non-pointer-like type so its methods are "inherited" (`impl Deref<Target = Base> for
  Derived`) is a footgun — it makes `Derived` implicitly coercible to `&Base` everywhere,
  including contexts where that's surprising (trait resolution, autoref). Reserve `Deref` for
  actual smart pointers (`Box`, `Arc`, `Rc`, `Cow`, and purpose-built wrapper types).
- **Sealed traits for closed hierarchies (C-SEALED).** A trait meant to have a fixed,
  crate-defined set of implementors (so the crate can add methods without a semver break) should
  be sealed with a private supertrait (`mod sealed { pub trait Sealed {} } pub trait MyTrait:
  sealed::Sealed { ... }`) — an unsealed public trait with only in-crate implementors today can
  still be implemented by downstream crates, which then breaks if the crate adds a method.
- **Returning `Vec<T>` vs. an iterator (C-INTERMEDIATE).** A function returning `Vec<T>` when
  callers typically chain further (`.sum()`, `.take(n)`, `.filter(...)`) forces an allocation the
  caller may not need — consider `impl Iterator<Item = T> + '_` instead. `Vec` is still the right
  choice when callers usually need random access, when producing the iterator is itself expensive
  (e.g., a disk read), or when the lazy iterator would carry an unwieldy lifetime.
