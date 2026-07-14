---
pack: js-test-frameworks
loads_into: [tests]
verified: "2026-07"
sources:
  - https://jestjs.io/docs/getting-started
  - https://vitest.dev/guide/
verify: "Check the repo's actual jest.config.*/vitest.config.* for globals/hoisting settings before assuming a project's default mocking behavior."
---

# Jest & Vitest

Jest and Vitest share nearly identical test-authoring APIs (`vi.*` mirrors `jest.*`); the pitfalls
below apply to both unless noted.

## Facts to check against

- **Mocks not restored between tests.** A `jest.spyOn`/`vi.spyOn` (or `jest.mock`/`vi.mock`) with
  no `afterEach(() => vi.restoreAllMocks())` leaks mock state into later tests, causing
  order-dependent failures.
- **`toBe` on objects.** `toBe` uses `Object.is` (reference equality) — comparing two structurally
  equal but distinct object instances always fails. Use `toEqual`, or `toStrictEqual` for the
  stronger check that also catches `undefined` properties and wrong class instances.
- **Snapshot tests as the sole assertion.** A test whose only assertion is `toMatchSnapshot()`
  passes trivially on first run and gets blindly updated on every subsequent change — pair it with
  a specific behavioral assertion, or skip the snapshot entirely.
- **Async error tests with no assertion guard.** A `try { await f() } catch (e) { expect(...) }`
  with no `expect.assertions(n)` passes silently if `f()` never throws — either add
  `expect.assertions(1)`, or prefer `await expect(f()).rejects.toThrow(...)`.
- **Non-deterministic test data.** `new Date()`/`Date.now()`/`Math.random()` used directly in test
  fixtures produces a different value every run — use a fixed constant, or `vi.useFakeTimers()` +
  `vi.setSystemTime(...)` for genuinely time-dependent behavior.
- **Overly broad module mocking.** `jest.mock('./utils')` with no factory replaces the *entire*
  module, including functions the test didn't intend to mock — prefer `jest.mock('./utils', () =>
  ({ ...jest.requireActual('./utils'), fetchData: jest.fn() }))` (Vitest: `vi.importActual`).
- **`done` callbacks instead of async/await.** Callback-style async tests are error-prone (a
  thrown error inside the callback doesn't fail the test) — prefer `async`/`await`.
- **Tests with no meaningful assertion.** A test that exercises code but never calls `expect(...)`
  on the result always passes regardless of correctness.
- **Shared mutable state between tests.** A module-level object mutated by one test and read by
  another creates order-dependent failures — reset state in `beforeEach`.
- **Jest hoists `jest.mock()` above imports; Vitest does not hoist `vi.mock()`.** This is a real
  behavioral difference between the two frameworks worth flagging if code assumes the other's
  semantics (e.g., a Vitest project written as if `vi.mock` calls run before the imports below
  them).
