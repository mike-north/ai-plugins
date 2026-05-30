# Changeset Review Guidance

## Overview

Changesets is a versioning and changelog management tool for monorepos, primarily used with npm/pnpm/yarn workspaces. It automates version bumping and changelog generation based on developer-written changeset files.

**Core workflow:**
1. Developer makes a change affecting the public API
2. Developer runs `changeset add` to create a `.changeset/*.md` file describing the change
3. On release, changesets consumes these files to bump versions and update CHANGELOGs

## Common Mistakes

### 1. Missing Changeset for Public API Changes

**Problem:** A PR modifies the public API but includes no changeset.

**What to check:**
- Does the PR modify exported functions, types, classes, or components?
- Does it change behavior that consumers depend on?
- Does it affect the documented API surface?

**Exception:** Internal-only changes (tests, docs, build config) don't need changesets.

**Example of missing changeset:**
```typescript
// Before
export function parseConfig(path: string): Config { ... }

// After - adds new parameter (breaking change, needs changeset)
export function parseConfig(path: string, options?: ParseOptions): Config { ... }
```

### 2. Wrong Semver Bump

**Problem:** Changeset specifies `patch` for a breaking change, or `major` for a bug fix.

**Semver decision tree:**

```
Does it break existing code?
├─ Yes → major
└─ No
   └─ Does it add new functionality?
      ├─ Yes → minor
      └─ No → patch
```

**TypeScript-specific:**
- **Breaking:** Narrowing types (string → "foo" | "bar"), removing optional markers, changing return types
- **Minor:** Adding optional parameters, widening types (accepting more inputs)
- **Patch:** Internal type refactoring with no consumer impact

**Common errors:**
```markdown
❌ Bad: patch for breaking change
---
"my-lib": patch
---
Remove deprecated `oldMethod` function

✅ Good: major for breaking change
---
"my-lib": major
---
Remove deprecated `oldMethod` function (use `newMethod` instead)
```

### 3. Forgetting Umbrella Package in Monorepo

**Problem:** A scoped package changes, and that change is re-exported through an umbrella package, but only the scoped package is listed in the changeset.

**Pattern to detect:**
- Repo has both `@scope/package` (scoped) and `package` (unscoped) packages
- The unscoped package typically re-exports from scoped packages
- Change affects a scoped package that's re-exported by umbrella

**Example structure:**
```
packages/
├── tui-components/        # Umbrella: re-exports everything
│   └── src/index.ts       # export * from '@tui/core';
├── core/                  # @tui/core
└── chart/                 # @tui/chart
```

**Correct changeset when changing `@tui/core`:**
```markdown
✅ Good
---
"@tui/core": minor
"tui-components": minor
---
Add new `theme` option to Button component
```

**Incorrect:**
```markdown
❌ Bad (missing umbrella)
---
"@tui/core": minor
---
Add new `theme` option to Button component
```

### 4. Unhelpful Changelog Entries

**Problem:** The changeset description is too vague or implementation-focused.

**Bad examples:**
```markdown
❌ "fix bug"
❌ "update code"
❌ "refactor parser implementation"
❌ "changes to config handling"
```

**Good examples:**
```markdown
✅ "Fix crash when parsing empty config files"
✅ "Add support for YAML configuration format"
✅ "Improve performance of large file parsing by 50%"
```

**Key principle:** Write for **consumers**, not implementers. Answer "what does this mean for someone using this library?"

### 5. Multiple Changesets for One Logical Change

**Problem:** Multiple `.changeset/*.md` files for what should be a single version bump.

**When to use one changeset:**
- All changes are part of the same feature
- All changes should be released together
- All changes affect the same package(s)

**When to use multiple changesets:**
- Changes to unrelated packages that could be released independently
- Stacked PRs where each PR is independently releasable

**Anti-pattern:**
```bash
# Three changesets all describing the same feature
.changeset/happy-lions-jump.md    # "Add validation"
.changeset/angry-bears-run.md     # "Add validation tests"
.changeset/brave-foxes-walk.md    # "Update docs for validation"
```

**Better:**
```bash
# One changeset for the whole feature
.changeset/add-validation.md      # "Add input validation with customizable rules"
```

### 6. Empty or Placeholder Changesets

**Problem:** Changeset exists but has no description or uses a placeholder.

```markdown
❌ Bad
---
"my-lib": patch
---
```

```markdown
❌ Bad
---
"my-lib": minor
---
TBD
```

**Minimum quality bar:** One sentence explaining what changed and why it matters.

## What to Check During Review

### 1. Changeset Completeness

**Questions to ask:**
- [ ] Is there a changeset file (`.changeset/*.md`) for this PR?
- [ ] Does the changeset include all affected packages?
- [ ] If there's an umbrella package that re-exports this change, is it included?

**How to verify umbrella package inclusion:**
1. Find the umbrella package (usually unscoped, matches repo name)
2. Check its `src/index.ts` or `index.ts` for re-exports
3. If the changed package is re-exported, umbrella must be in changeset

### 2. Semver Correctness

**Breaking changes (major):**
- Removing exported functions, types, or components
- Renaming exports
- Changing function signatures (reordering params, removing params)
- Narrowing types (more restrictive)
- Changing default behavior in a way that breaks existing code
- Dropping support for a major version of a dependency (e.g., Node 14)

**New features (minor):**
- Adding new exports
- Adding optional parameters
- Widening types (accepting more inputs)
- New methods on existing classes

**Bug fixes and internals (patch):**
- Fixing incorrect behavior to match documentation
- Performance improvements with no API change
- Internal refactoring
- Documentation/test changes

**Edge case: Type-only changes in TypeScript**
```typescript
// Breaking (major): narrows type
-export function parse(input: string | Buffer): Result
+export function parse(input: string): Result

// Minor: widens type
-export function parse(input: string): Result
+export function parse(input: string | Buffer): Result

// Patch: internal type refactor, no consumer impact
-export function parse(input: string): { data: any }
+export function parse(input: string): { data: unknown }
```

### 3. Changelog Quality

**Good changelog entry checklist:**
- [ ] Written from a consumer's perspective
- [ ] Explains what changed (not how it was implemented)
- [ ] Explains why it matters (if not obvious)
- [ ] Includes migration guidance for breaking changes
- [ ] Uses complete sentences
- [ ] Is specific, not vague

**Before/after examples:**

❌ **Bad:**
```markdown
---
"stripe-cli": patch
---
Update trigger code
```

✅ **Good:**
```markdown
---
"stripe-cli": minor
---
Add 67 new event triggers including `invoice.paid`, `customer.subscription.updated`, and all application fee events. See `stripe trigger --help` for the full list.
```

❌ **Bad:**
```markdown
---
"@acme/parser": major
---
Breaking changes to API
```

✅ **Good:**
```markdown
---
"@acme/parser": major
---
Remove `parseSync` in favor of async `parse` function. If you need synchronous parsing, use `parseToString` then parse the string with `JSON.parse`.
```

### 4. Internal-Only Changes (No Changeset Needed)

**Changes that DON'T need a changeset:**
- Test additions/modifications
- Documentation updates (README, code comments)
- Build configuration changes
- CI/CD changes
- Linting/formatting changes
- Internal refactoring with no API impact
- Developer tooling (scripts, etc.)

**If the PR is entirely internal-only, verify there's no changeset.**

### 5. Pre-1.0 Semantics

**For 0.x versions:**
- Breaking changes can be `minor` (0.3.0 → 0.4.0)
- New features can be `minor` (0.3.0 → 0.4.0)
- Bug fixes are `patch` (0.3.0 → 0.3.1)

**Many projects still use standard semver (major for breaking) even pre-1.0. Check the project's conventions.**

## Good Changelog Entries vs Bad Ones

### Example 1: Bug Fix

❌ **Bad:**
```markdown
---
"config-loader": patch
---
fix issue
```

✅ **Good:**
```markdown
---
"config-loader": patch
---
Fix crash when loading config files with trailing commas in JSON
```

### Example 2: New Feature

❌ **Bad:**
```markdown
---
"ui-components": minor
---
add stuff
```

✅ **Good:**
```markdown
---
"ui-components": minor
---
Add `size` prop to Button component. Supports "small", "medium", and "large" (default: "medium").
```

### Example 3: Breaking Change

❌ **Bad:**
```markdown
---
"api-client": major
---
breaking changes
```

✅ **Good:**
```markdown
---
"api-client": major
---
Remove deprecated `client.get()` method. Use `client.request({ method: 'GET' })` instead. This was deprecated in v2.5.0.
```

### Example 4: Multiple Packages

❌ **Bad:**
```markdown
---
"@acme/core": minor
---
add feature to core
```

✅ **Good (when core is re-exported by umbrella):**
```markdown
---
"@acme/core": minor
"acme": minor
---
Add `validateEmail` utility function to core package
```

## Semver Decision Guide

### When is something breaking?

**Golden rule:** If existing code that worked before will now break or behave differently, it's breaking.

**Detailed scenarios:**

| Change | Semver | Reasoning |
|--------|--------|-----------|
| Remove exported function | major | Existing imports break |
| Rename exported function | major | Existing imports break |
| Add required parameter | major | Existing calls break |
| Add optional parameter | minor | Existing calls still work |
| Change return type (incompatible) | major | Consumers expecting old type break |
| Widen parameter type | minor | Accepts more inputs (backwards compatible) |
| Narrow parameter type | major | Some previously valid inputs rejected |
| Change side effects/behavior | major* | Depends on whether it breaks documented contracts |
| Fix bug to match docs | patch | Fixing incorrect behavior |
| Add new export | minor | Only adds, doesn't break |
| Mark something @deprecated | minor | Still works, just warns |
| Remove @deprecated item | major | Now actually breaks |

*Behavior changes are major if they break documented/expected behavior, patch if they fix a bug.

**TypeScript-specific scenarios:**

| Change | Semver | Reasoning |
|--------|--------|-----------|
| `foo: string \| null` → `foo: string` | major | Consumers handling null will break |
| `foo: string` → `foo: string \| null` | major | Consumers not checking null will break |
| `foo?: string` → `foo: string` | major | Property becomes required |
| `foo: string` → `foo?: string` | minor | Property becomes more flexible |
| `foo: any` → `foo: unknown` | major | Requires type guards |
| `foo: unknown` → `foo: any` | minor | More permissive |

### Type-Only Libraries

For libraries that only export types (no runtime code):
- Changes to exported types follow the same semver rules
- Internal type changes (not exported) don't need changesets
- Adding new exported types is `minor`
- Changing exported types in incompatible ways is `major`

## Monorepo-Specific Guidance

### When to Include Umbrella Package

**Include umbrella package when:**
- The scoped package change is re-exported by the umbrella
- Consumers using the umbrella package will see the change

**Don't include umbrella package when:**
- The scoped package is intended for direct consumption only
- The change is internal to the scoped package and not re-exported

**How to verify:**
```typescript
// packages/umbrella/src/index.ts
export * from '@scope/core';  // ← core changes need umbrella changeset
export * from '@scope/utils'; // ← utils changes need umbrella changeset
// (internal-package not exported) // ← internal changes DON'T need umbrella
```

### Multiple Packages in One Changeset

**Correct pattern:**
```markdown
---
"@scope/core": minor
"@scope/utils": minor
"umbrella": minor
---
Add validation utilities to core and utils packages
```

**When packages have different semver bumps:**
```markdown
---
"@scope/core": major
"@scope/plugin-a": minor
"@scope/plugin-b": patch
"umbrella": major
---
Core: Remove deprecated API (breaking)
Plugin A: Add new feature
Plugin B: Fix bug
```

## Review Checklist

**For every PR that touches code:**

1. **Presence:**
   - [ ] If public API changed → changeset exists
   - [ ] If only internal → no changeset (or explicitly noted)

2. **Semver:**
   - [ ] Breaking changes → major
   - [ ] New features → minor
   - [ ] Bug fixes → patch
   - [ ] Type changes follow TypeScript semver rules

3. **Scope:**
   - [ ] All affected packages included
   - [ ] Umbrella package included if change is re-exported
   - [ ] Internal packages correctly excluded

4. **Quality:**
   - [ ] Description is consumer-focused
   - [ ] Description is specific and actionable
   - [ ] Breaking changes include migration guidance
   - [ ] No placeholder/empty descriptions

5. **Grouping:**
   - [ ] Related changes in one changeset
   - [ ] Independent changes in separate changesets

## Resources

- [Changesets documentation](https://github.com/changesets/changesets)
- [Semantic Versioning specification](https://semver.org/)
- [TypeScript and Semantic Versioning](https://www.semver-ts.org/)
