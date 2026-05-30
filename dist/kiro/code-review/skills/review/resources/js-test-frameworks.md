# JavaScript Test Framework Review Guidance (Jest & Vitest)

## Overview

Jest (Meta) and Vitest (Vite-native) share nearly identical APIs for test authoring. Vitest uses `vi.*` where Jest uses `jest.*`, but patterns, pitfalls, and best practices are the same. This guide covers both.

**API mapping:**
| Jest | Vitest |
|------|--------|
| `jest.fn()` | `vi.fn()` |
| `jest.mock()` | `vi.mock()` |
| `jest.spyOn()` | `vi.spyOn()` |
| `jest.useFakeTimers()` | `vi.useFakeTimers()` |
| `jest.restoreAllMocks()` | `vi.restoreAllMocks()` |

## Common Mistakes (Both Frameworks)

### 1. Not Restoring Mocks Between Tests

**Problem:** Mock state leaks between tests, causing order-dependent failures.

**Anti-pattern:**
```typescript
describe('UserService', () => {
  it('test A', () => {
    jest.spyOn(db, 'query').mockResolvedValue([]);
    // mock not restored...
  });
  it('test B', () => {
    // db.query is STILL mocked from test A!
  });
});
```

**Fix:** Always restore in afterEach:
```typescript
afterEach(() => {
  jest.restoreAllMocks(); // or vi.restoreAllMocks()
});
```

### 2. Using `toBe` for Objects

**Problem:** `toBe` uses `Object.is`, which fails for structurally equal objects.

```typescript
// ❌ FAILS: different object references
expect({ a: 1 }).toBe({ a: 1 });

// ✅ Use toEqual or toStrictEqual
expect({ a: 1 }).toEqual({ a: 1 });
expect({ a: 1 }).toStrictEqual({ a: 1 }); // stricter: checks undefined properties too
```

Prefer `toStrictEqual` — it catches more bugs by checking for `undefined` properties and class instances.

### 3. Snapshot Tests as Sole Assertions

**Problem:** Snapshot tests pass trivially on first run and are often blindly updated.

**Anti-pattern:**
```typescript
it('renders correctly', () => {
  const result = render(<UserCard user={mockUser} />);
  expect(result).toMatchSnapshot(); // This IS the whole test
});
```

**Fix:** Pair snapshots with behavioral assertions:
```typescript
it('renders user name and email', () => {
  const result = render(<UserCard user={mockUser} />);
  expect(result.getByText('Alice')).toBeTruthy();
  expect(result.getByText('alice@example.com')).toBeTruthy();
  expect(result).toMatchSnapshot(); // Supplementary, not primary
});
```

### 4. Async Tests Without Proper Assertion Guards

**Problem:** Async error tests might not actually run the catch path.

```typescript
// ❌ BAD: If fetchUser doesn't throw, test passes silently
it('throws on invalid ID', async () => {
  try {
    await fetchUser('invalid');
  } catch (e) {
    expect(e.message).toBe('User not found');
  }
});

// ✅ GOOD: expect.assertions guarantees the catch ran
it('throws on invalid ID', async () => {
  expect.assertions(1);
  try {
    await fetchUser('invalid');
  } catch (e) {
    expect(e.message).toBe('User not found');
  }
});

// ✅ BETTER: Use rejects matcher
it('throws on invalid ID', async () => {
  await expect(fetchUser('invalid')).rejects.toThrow('User not found');
});
```

### 5. Using Real Dates/Timers in Tests

**Problem:** `new Date()` or `Date.now()` produces different values every run.

```typescript
// ❌ BAD: Non-deterministic
const fixture = { createdAt: new Date() };

// ✅ GOOD: Fixed dates
const CREATED_AT = new Date('2024-01-15T10:30:00.000Z');
const fixture = { createdAt: CREATED_AT };
```

For time-dependent behavior, use fake timers:
```typescript
beforeEach(() => {
  jest.useFakeTimers(); // or vi.useFakeTimers()
  jest.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
});
afterEach(() => {
  jest.useRealTimers(); // or vi.useRealTimers()
});
```

### 6. Module Mocking Too Broadly

**Problem:** Mocking an entire module when only one function is needed.

```typescript
// ❌ BAD: Mocks everything, losing real implementations
jest.mock('./utils');

// ✅ GOOD: Mock only what you need
jest.mock('./utils', () => ({
  ...jest.requireActual('./utils'),
  fetchData: jest.fn(),
}));

// Vitest equivalent:
vi.mock('./utils', async () => ({
  ...(await vi.importActual('./utils')),
  fetchData: vi.fn(),
}));
```

### 7. Using `done` Callbacks Instead of async/await

**Problem:** `done` callbacks are error-prone and don't propagate errors well.

```typescript
// ❌ BAD: done callback
it('fetches data', (done) => {
  fetchData().then((data) => {
    expect(data).toBeDefined();
    done();
  });
});

// ✅ GOOD: async/await
it('fetches data', async () => {
  const data = await fetchData();
  expect(data).toBeDefined();
});
```

### 8. Tests Without Meaningful Assertions

**Problem:** Test runs code but doesn't verify behavior.

```typescript
// ❌ BAD: No assertion — always passes
it('processes data', () => {
  processData(input);
});

// ✅ GOOD: Verify the outcome
it('processes data and returns formatted result', () => {
  const result = processData(input);
  expect(result).toEqual(expectedOutput);
});
```

### 9. Shared Mutable State Between Tests

**Problem:** Tests modify shared objects, creating order-dependent failures.

```typescript
// ❌ BAD: Shared mutable state
const config = { debug: false };

describe('Logger', () => {
  it('enables debug mode', () => {
    config.debug = true; // Mutates shared state!
    expect(createLogger(config).isDebug).toBe(true);
  });
  it('defaults to non-debug', () => {
    // FAILS: config.debug is still true from previous test
    expect(createLogger(config).isDebug).toBe(false);
  });
});

// ✅ GOOD: Fresh state per test
describe('Logger', () => {
  let config: Config;
  beforeEach(() => {
    config = { debug: false };
  });
  // ...
});
```

## Jest-Specific Issues

### Module Mock Hoisting

Jest hoists `jest.mock()` calls above imports. This can be surprising:

```typescript
// This looks like it runs after import, but jest.mock is hoisted ABOVE it
import { UserService } from './UserService';
jest.mock('./UserService');

// Variables referenced inside jest.mock must be prefixed with 'mock'
const mockFetch = jest.fn();
jest.mock('./api', () => ({
  fetch: mockFetch, // Only works because variable starts with 'mock'
}));
```

Vitest does NOT hoist `vi.mock()` — it runs in place. This is a key behavioral difference.

### Manual Mocks (`__mocks__/` directory)

Jest supports `__mocks__/` directories for automatic module replacement. Check that:
- Manual mocks stay in sync with the real module's API
- Manual mocks are intentional (not leftover from debugging)
- Tests that need the real module use `jest.requireActual()`

## Vitest-Specific Issues

### Using Jest Syntax Accidentally

```typescript
// ❌ Wrong: Jest syntax in Vitest project
jest.fn()
jest.mock('./module')

// ✅ Correct: Vitest syntax
vi.fn()
vi.mock('./module')
```

### In-Source Testing

Vitest supports in-source testing with `import.meta.vitest`. Check that:
- In-source tests are stripped from production builds
- `define` config is set in `vitest.config.*` for tree-shaking

### Globals Configuration

If `globals: true` is set in vitest config, `describe`/`it`/`expect` don't need imports. But:
- TypeScript needs `/// <reference types="vitest/globals" />` in a `.d.ts` file
- Mixing global and import styles in the same project is confusing

## What to Check During Review

### Mock Quality
- [ ] Are mocks restored in `afterEach`?
- [ ] Are mocks minimal (not mocking entire modules unnecessarily)?
- [ ] Do mock return values match the real module's types?
- [ ] Are `jest.spyOn`/`vi.spyOn` preferred over full module mocks where possible?

### Assertion Quality
- [ ] Does every test have at least one meaningful assertion?
- [ ] Are snapshot tests paired with behavioral assertions?
- [ ] Is `toStrictEqual` used instead of `toEqual` for object comparisons?
- [ ] Do async error tests use `expect.assertions()` or `.rejects`?

### Test Isolation
- [ ] Is there shared mutable state between tests?
- [ ] Are timers faked and restored properly?
- [ ] Are mocks scoped appropriately (not leaking between describes)?

### Test Organization
- [ ] Are `describe` blocks organized by feature/method/scenario?
- [ ] Are test descriptions behavior-focused ("should X when Y")?
- [ ] Is setup code extracted to `beforeEach` or helper functions?
- [ ] Is duplicated test data extracted to fixtures or factories?

### Coverage
- [ ] Are both success and failure paths tested?
- [ ] Are edge cases covered (empty input, null, boundary values)?
- [ ] Are async paths tested (success, rejection, timeout)?
- [ ] If utility types exist, are they tested with `tsd`?

## Review Checklist

1. [ ] `afterEach` restores all mocks
2. [ ] No `toBe` on objects (use `toEqual`/`toStrictEqual`)
3. [ ] No snapshot-only tests
4. [ ] No `done` callbacks (use async/await)
5. [ ] No `new Date()` in test data (use fixed dates or fake timers)
6. [ ] Every test has meaningful assertions
7. [ ] No shared mutable state
8. [ ] `expect.assertions(N)` used in try/catch async tests
9. [ ] Module mocks are minimal and targeted
10. [ ] Test descriptions describe behavior, not implementation

## References

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Vitest Documentation](https://vitest.dev/guide/)
- [Testing Library Best Practices](https://testing-library.com/docs/)
