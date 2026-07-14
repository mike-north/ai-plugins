---
pack: testing-judgment
loads_into: [tests]
verified: "2026-07"
sources:
  - https://en.wikipedia.org/wiki/Year_2038_problem
  - https://nodejs.org/api/fs.html#file-system-flags
verify: "Only flag filesystem-path edge cases (separators, case-sensitivity) when the code under test actually manipulates paths as strings rather than delegating to a path library that already normalizes them."
---

# Testing judgment: filesystem and concurrency edge cases

## Facts to check against

- **Path handling tested only on the developer's own OS conventions.** Code that builds or
  compares file paths as strings (rather than through a path library) behaves differently across
  platforms: `/` vs. `\` separators, case-sensitive (Linux/most CI) vs. case-insensitive-but-
  case-preserving (macOS default, Windows) filesystems, and symlink resolution. A test suite with
  no case-variance or separator-variance case for path-comparison logic will pass in CI and still
  break for a user on a case-insensitive filesystem — or the reverse, pass locally on macOS and
  fail in Linux CI.
- **Date-boundary tests stopping short of known hard limits.** Beyond the generic "leap year/DST/
  timezone" cases, a system storing timestamps as a 32-bit signed integer (common in older schemas,
  some binary protocols, and C-derived bindings) overflows on 2038-01-19 — a test suite for
  date-handling logic that never exercises a near-future or post-2038 date won't catch a codebase
  that's still using a 32-bit epoch representation somewhere in its stack.
- **Concurrency-relevant test gaps beyond generic race conditions.** Two under-tested patterns:
  starvation (a low-priority operation that a test suite never runs long enough, or under enough
  concurrent load, to prove it eventually completes rather than being perpetually preempted), and
  cache invalidation mid-update (a read that lands between a cache write and its corresponding
  invalidation, observing a stale-but-not-yet-evicted value) — both require a test that
  deliberately interleaves operations (via a controllable clock/scheduler or explicit
  synchronization points), not just a "run two goroutines/threads and hope" test, which is
  non-deterministic and won't reliably catch the bug even when present.
