# API Extractor Review Guidance

## Overview

API Extractor is Microsoft's tool for generating `.d.ts` rollups, validating API surface areas, and producing API reports for TypeScript libraries. It enforces API boundaries and tracks API changes over time.

**Core workflow:**
1. TypeScript compiler generates `.d.ts` files
2. API Extractor processes the main entry point `.d.ts`
3. Generates a single rollup `.d.ts` and an API report markdown file
4. Validates release tags (`@public`, `@beta`, `@internal`) and API surface

## Common Mistakes

### 1. Accidentally Exporting Internal Types

**Problem:** Internal implementation types leak into the public API without `@internal` tags.

**What to check:**
```typescript
// ❌ Bad: internal type is exported
export interface DatabaseConnection { ... }  // Should be internal
export function query(sql: string): Promise<Result>;

// ✅ Good: internal type is marked
/** @internal */
export interface DatabaseConnection { ... }
export function query(sql: string): Promise<Result>;
```

**Why it matters:** Consumers might depend on internal types, making refactoring impossible.

**How to detect:**
- Look for `export` statements in the diff
- Check if new exports appear in the API report
- Verify that exported types are intentionally public

### 2. Missing Release Tags on New Public API

**Problem:** New public API is added without `@public`, `@beta`, or `@internal` tags.

**What to check:**
```typescript
// ❌ Bad: missing release tag
export function newFeature(): void;

// ✅ Good: explicitly tagged
/**
 * Processes the input data.
 * @public
 */
export function newFeature(): void;
```

**API Extractor's behavior without tags:**
- Defaults to treating exports as public (depending on config)
- May emit warnings or errors depending on `apiReport.reportFileName` settings

**Best practice:** Always require explicit `@public` or `@beta` on all exported members.

### 3. Breaking Changes to API Report Without Justification

**Problem:** The API report file shows breaking changes, but the PR doesn't explain why or include a major version bump.

**What to check:**
- Compare the API report diff (`api-report/*.md` or `etc/*.md`)
- Look for removals or signature changes
- Verify that breaking changes have:
  - A changeset with `major` bump
  - Documentation explaining the migration path
  - Justification for why the break is necessary

**Example API report diff:**
```diff
 export function parse(input: string): Result;

-export function parseSync(input: string): Result;
+// parseSync removed (breaking change)
```

**This requires:**
- Changeset with `major` bump
- Migration guide in the changeset description

### 4. Missing `@beta` Tag for Experimental APIs

**Problem:** New, unstable API is tagged `@public` instead of `@beta`.

**What to check:**
- Is this a new feature that might change?
- Is the API design still being validated?
- Does the documentation say "experimental" or "unstable"?

**Correct tagging:**
```typescript
/**
 * Experimental feature for advanced use cases.
 * This API is subject to change.
 * @beta
 */
export function experimentalFeature(): void;
```

**Why it matters:** `@beta` allows breaking changes in minor versions without a major bump.

### 5. Changed Function Signature That Breaks Consumers

**Problem:** A function signature change that looks minor but actually breaks consumers.

**Examples of breaking changes:**
```typescript
// ❌ Breaking: reordered parameters
-export function format(value: string, options: Options): string;
+export function format(options: Options, value: string): string;

// ❌ Breaking: removed optional parameter
-export function format(value: string, options?: Options): string;
+export function format(value: string): string;

// ❌ Breaking: narrowed return type
-export function parse(input: string): Record<string, unknown>;
+export function parse(input: string): Record<string, string>;

// ✅ Non-breaking: added optional parameter
-export function format(value: string): string;
+export function format(value: string, options?: Options): string;
```

**What to check:**
- Compare function signatures in the API report
- Verify that changes are backwards compatible or properly versioned as breaking

### 6. Misconfigured `api-extractor.json`

**Problem:** The configuration points to the wrong entry point or has incorrect paths.

**What to check:**
```json
{
  "mainEntryPointFilePath": "<projectFolder>/dist/index.d.ts",
  "apiReport": {
    "enabled": true,
    "reportFolder": "<projectFolder>/api-report/",
    "reportFileName": "<unscopedPackageName>.api.md"
  },
  "dtsRollup": {
    "enabled": true,
    "publicTrimmedFilePath": "<projectFolder>/dist/<unscopedPackageName>.d.ts"
  }
}
```

**Common misconfigurations:**
- `mainEntryPointFilePath` doesn't match actual build output
- `reportFolder` is wrong (should be committed to git)
- `publicTrimmedFilePath` doesn't match `package.json#types`

**Verify:**
1. `mainEntryPointFilePath` points to the compiled `.d.ts` entry point
2. `reportFolder` is committed to git (not in `.gitignore`)
3. `publicTrimmedFilePath` matches `package.json#types` field

### 7. Using `--local` in CI

**Problem:** CI uses `api-extractor run --local` which updates reports instead of validating them.

**Correct usage:**
- **Local development:** `api-extractor run --local` (updates API report)
- **CI validation:** `api-extractor run` (fails if API report is stale)

**What to check in CI scripts:**
```json
// ❌ Bad: updates report in CI
"scripts": {
  "build": "tsc && api-extractor run --local"
}

// ✅ Good: validates report in CI
"scripts": {
  "build": "tsc && api-extractor run",
  "build:local": "tsc && api-extractor run --local"
}
```

## What to Check During Review

### 1. API Report Changes

**Questions to ask:**
- [ ] Has the API report been updated (`api-report/*.md` or `etc/*.md`)?
- [ ] Are the changes in the API report intentional?
- [ ] Do breaking changes have a major version changeset?
- [ ] Do new exports have appropriate release tags?

**How to review the API report diff:**
1. Open the `.api.md` file diff in the PR
2. Look for additions (`+`) and removals (`-`)
3. For each change, verify:
   - Additions are properly tagged (`@public`, `@beta`, or `@internal`)
   - Removals are justified and versioned as breaking
   - Signature changes are backwards compatible or versioned as breaking

**Example good API report change:**
```diff
+/**
+ * Formats a date string.
+ * @param date - The date to format
+ * @returns Formatted string
+ * @public
+ */
+export function formatDate(date: Date): string;
```

### 2. Release Tag Validation

**Check that all exports have release tags:**
- `@public` - Stable, committed API
- `@beta` - Experimental, may change in minor versions
- `@internal` - Not for external use (exported for internal cross-package use)
- `@alpha` - Very unstable, may change in patch versions (rarely used)

**Anti-patterns:**
```typescript
// ❌ Missing tag on public export
export function doSomething(): void;

// ❌ Internal type without @internal tag
export interface InternalConfig { ... }

// ❌ Using @public for experimental API
/** @public */
export function experimentalFeature(): void;  // Should be @beta
```

### 3. `.d.ts` Rollup Verification

**Questions to ask:**
- [ ] Does `package.json#types` point to the rollup file?
- [ ] Is the rollup file actually generated and committed?
- [ ] Does the rollup include all public exports?
- [ ] Does the rollup exclude internal exports?

**Verify the rollup:**
```json
// package.json
{
  "types": "./dist/my-package.d.ts"  // Should match publicTrimmedFilePath
}
```

**Check that the file at this path:**
1. Exists in the PR
2. Contains the public API
3. Doesn't contain `@internal` exports

### 4. Breaking Changes

**Types of breaking changes to look for:**

| Change Type | Breaking? | Example |
|------------|-----------|---------|
| Remove export | Yes | Deleted function |
| Rename export | Yes | Changed function name |
| Change signature | Yes | Reordered parameters |
| Narrow type | Yes | `string \| number` → `string` |
| Remove optional param | Yes | `fn(a, b?)` → `fn(a)` |
| Make param required | Yes | `fn(a?)` → `fn(a)` |
| Add optional param | No | `fn(a)` → `fn(a, b?)` |
| Widen type | Maybe | `string` → `string \| number` (depends on variance) |
| Add new export | No | New function added |

**For each breaking change:**
- [ ] Is there a `major` version changeset?
- [ ] Does the changeset explain the migration path?
- [ ] Is the breaking change justified (not just churn)?

### 5. `@deprecated` Items

**Rules for deprecated items:**
- Should not be removed in minor/patch versions
- Should have `@deprecated` JSDoc tag with migration guidance
- Can be removed in the next major version

**Example:**
```typescript
/**
 * @deprecated Use `newMethod` instead. This will be removed in v3.0.0.
 * @public
 */
export function oldMethod(): void;
```

**What to check:**
```diff
-/**
- * @deprecated Use `newMethod` instead.
- */
-export function oldMethod(): void;
```

**If `@deprecated` is removed:**
- [ ] Is this a major version bump?
- [ ] Was the deprecation present for at least one major version?

### 6. Configuration Review

**When `api-extractor.json` changes:**
- [ ] Does `mainEntryPointFilePath` match the build output?
- [ ] Is `reportFolder` outside of build output (so it's committed)?
- [ ] Does `publicTrimmedFilePath` match `package.json#types`?
- [ ] Is `reportFileName` set correctly?

**Validation settings:**
```json
{
  "apiReport": {
    "enabled": true  // Should be true for libraries
  },
  "dtsRollup": {
    "enabled": true,  // Should be true for libraries
    "untrimmedFilePath": "",  // Can be empty
    "publicTrimmedFilePath": "<projectFolder>/dist/index.d.ts"
  },
  "messages": {
    "extractorMessageReporting": {
      "ae-missing-release-tag": {
        "logLevel": "error"  // Should error on missing tags
      }
    }
  }
}
```

## Release Tag Guidance

### When to use `@public`

**Use for:**
- Stable, committed API
- Features that won't change in minor/patch versions
- Core functionality that consumers depend on

**Example:**
```typescript
/**
 * Parses a configuration file.
 * @param path - Path to config file
 * @returns Parsed configuration object
 * @public
 */
export function parseConfig(path: string): Config;
```

### When to use `@beta`

**Use for:**
- New features still being validated
- Experimental APIs
- Features that might change based on feedback

**Example:**
```typescript
/**
 * Experimental streaming parser (may change in minor versions).
 * @param path - Path to config file
 * @returns Async iterator of config chunks
 * @beta
 */
export function parseConfigStream(path: string): AsyncIterableIterator<Partial<Config>>;
```

**Key difference from `@public`:**
- `@beta` APIs can have breaking changes in minor versions
- `@public` APIs can only break in major versions

### When to use `@internal`

**Use for:**
- Exports needed by other packages in the monorepo
- Implementation details that must be exported due to TypeScript limitations
- Types that should never be used by consumers

**Example:**
```typescript
/**
 * Internal database connection pool (do not use directly).
 * @internal
 */
export interface ConnectionPool { ... }
```

**Key point:** `@internal` exports are excluded from the `.d.ts` rollup.

### When to use `@alpha`

**Use sparingly for:**
- Very unstable APIs that might change rapidly
- Proof-of-concept features
- APIs under active development

**Most projects should use `@beta` instead of `@alpha`.**

## How to Read the API Report Diff

### Structure of an API Report

```typescript
// @public
export function functionName(param: Type): ReturnType;

// @public (undocumented)
export interface InterfaceName { ... }

// @beta
export function experimentalFeature(): void;
```

### Reading a Diff

**Added export:**
```diff
+// @public
+export function newFeature(): void;
```
**Check:** Is `@public` the right tag? Should this be `@beta`?

**Removed export:**
```diff
-// @public
-export function oldFeature(): void;
```
**Check:** Is there a major version changeset? Is this justified?

**Changed signature:**
```diff
-export function parse(input: string): Result;
+export function parse(input: string, options?: Options): Result;
```
**Check:** Is this backwards compatible? (Yes, optional param is safe)

**Changed release tag:**
```diff
-// @beta
+// @public
```
**Check:** Has the API been stable long enough to promote to `@public`?

**Undocumented warning:**
```diff
-// @public
+// @public (undocumented)
```
**Check:** Should add JSDoc comments for public API.

## Configuration Best Practices

### Recommended `api-extractor.json`

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "mainEntryPointFilePath": "<projectFolder>/dist/index.d.ts",
  "apiReport": {
    "enabled": true,
    "reportFolder": "<projectFolder>/api-report/",
    "reportFileName": "<unscopedPackageName>.api.md"
  },
  "dtsRollup": {
    "enabled": true,
    "publicTrimmedFilePath": "<projectFolder>/dist/<unscopedPackageName>.d.ts"
  },
  "messages": {
    "extractorMessageReporting": {
      "ae-missing-release-tag": {
        "logLevel": "error"
      },
      "ae-forgotten-export": {
        "logLevel": "error"
      }
    }
  }
}
```

### Git Setup

**Commit these:**
- `api-report/*.api.md` - The API report file
- `dist/*.d.ts` - The rollup (if publishing to git)

**Gitignore these:**
- `temp/` - API Extractor's working directory
- `dist/` (if not publishing to git)

**Add to `.gitattributes`:**
```
api-report/** linguist-generated=true
```

## Review Checklist

**For every PR that touches public API:**

1. **API Report:**
   - [ ] API report file is updated
   - [ ] Changes match the code changes
   - [ ] No unexpected additions or removals

2. **Release Tags:**
   - [ ] All new exports have explicit tags
   - [ ] `@public` for stable API
   - [ ] `@beta` for experimental API
   - [ ] `@internal` for cross-package internals

3. **Breaking Changes:**
   - [ ] Removals have major changeset
   - [ ] Signature changes are backwards compatible or major
   - [ ] Deprecated items not removed in minor/patch

4. **Documentation:**
   - [ ] Public API has JSDoc comments
   - [ ] Parameters documented with `@param`
   - [ ] Return values documented with `@returns`
   - [ ] No "(undocumented)" warnings for public API

5. **Configuration:**
   - [ ] `mainEntryPointFilePath` is correct
   - [ ] `publicTrimmedFilePath` matches `package.json#types`
   - [ ] `reportFolder` is outside build output

6. **Build Integration:**
   - [ ] `--local` used for local development only
   - [ ] CI omits `--local` (validates instead of updates)

## Resources

- [API Extractor documentation](https://api-extractor.com/)
- [TSDoc specification](https://tsdoc.org/)
- [Semantic Versioning for TypeScript](https://www.semver-ts.org/)
