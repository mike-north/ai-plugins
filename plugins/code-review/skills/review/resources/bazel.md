# Bazel Review Guidance

## Overview

Bazel is Google's build system for multi-language, large-scale projects. It provides hermetic builds, remote caching, and fine-grained dependency tracking. Key concepts:

- **Targets**: Buildable units defined in BUILD files (`cc_library`, `go_binary`, `java_test`, etc.)
- **Labels**: Unique identifiers for targets (`//path/to:target`)
- **Packages**: Directories containing BUILD files
- **Visibility**: Controls which packages can depend on a target
- **Workspace**: Root of the project, defined by WORKSPACE or MODULE.bazel

## Common Mistakes

### 1. deps vs runtime_deps Confusion

**Problem:** `deps` are compile-time dependencies; `runtime_deps` are only needed at runtime. Mixing them up causes either build failures or unnecessary rebuilds.

```python
# ❌ BAD: Runtime-only dependency in deps (forces recompilation when it changes)
java_library(
    name = "server",
    srcs = glob(["*.java"]),
    deps = [
        "//lib:core",
        "//lib:logging",     # Only used at runtime via reflection
        "//lib:config-impl", # Only needed at runtime
    ],
)

# ✅ GOOD: Separated correctly
java_library(
    name = "server",
    srcs = glob(["*.java"]),
    deps = [
        "//lib:core",
    ],
    runtime_deps = [
        "//lib:logging",
        "//lib:config-impl",
    ],
)
```

**Check:**
- Is each dependency actually imported/used at compile time?
- Would moving it to `runtime_deps` reduce rebuilds?
- For Go: `deps` = imported packages; data files go in `data`

### 2. Overly Broad Visibility

**Problem:** Using `//visibility:public` everywhere defeats the purpose of visibility controls.

```python
# ❌ BAD: Everything is public
java_library(
    name = "internal_utils",
    srcs = glob(["*.java"]),
    visibility = ["//visibility:public"],
)

# ✅ GOOD: Scoped visibility
java_library(
    name = "internal_utils",
    srcs = glob(["*.java"]),
    visibility = ["//mypackage:__subpackages__"],
)

# ✅ GOOD: Specific consumers
java_library(
    name = "shared_api",
    srcs = glob(["*.java"]),
    visibility = [
        "//services/frontend:__pkg__",
        "//services/backend:__pkg__",
    ],
)
```

**Visibility patterns:**
- `//visibility:public` — anyone can depend on this (use sparingly)
- `//visibility:private` — only the package itself (default)
- `//pkg:__pkg__` — only the specified package
- `//pkg:__subpackages__` — the package and all sub-packages
- `["//a:__pkg__", "//b:__pkg__"]` — specific allowlist

**Check:**
- Is `//visibility:public` justified? Most targets should be package-private or scoped
- Are internal implementation targets hidden from external consumers?
- Does the visibility match the intended API surface?

### 3. Missing data Dependencies for Tests

**Problem:** Test data files not declared in `data` attribute → tests fail in sandboxed execution.

```python
# ❌ BAD: Test reads files not declared as data
go_test(
    name = "parser_test",
    srcs = ["parser_test.go"],
    deps = [":parser"],
    # Missing: data = ["testdata/input.json", "testdata/expected.json"]
)

# ✅ GOOD: Test data explicitly declared
go_test(
    name = "parser_test",
    srcs = ["parser_test.go"],
    deps = [":parser"],
    data = glob(["testdata/**"]),
)
```

**Check:**
- Do tests read files from disk? If so, are those files in `data`?
- Are glob patterns for test data specific enough (not pulling in unrelated files)?
- Are test fixtures in a conventional location (`testdata/`, `fixtures/`)?

### 4. Incorrect glob Patterns

**Problem:** Glob patterns that are too broad include unintended files (test files in library targets, generated files, etc.).

```python
# ❌ BAD: Includes test files in the library
go_library(
    name = "mylib",
    srcs = glob(["*.go"]),  # Includes _test.go files!
)

# ✅ GOOD: Exclude test files
go_library(
    name = "mylib",
    srcs = glob(
        ["*.go"],
        exclude = ["*_test.go"],
    ),
)

# ❌ BAD: Too broad, includes generated files
java_library(
    name = "mylib",
    srcs = glob(["**/*.java"]),  # Might include generated code
)

# ✅ GOOD: Specific source directory
java_library(
    name = "mylib",
    srcs = glob(["src/main/java/**/*.java"]),
)
```

**Check:**
- Do library globs exclude test files?
- Are globs scoped to the right directories?
- Could the glob accidentally include generated files?

### 5. Gazelle Not Synced (Go projects)

**Problem:** `go.mod`/`go.sum` updated but Gazelle hasn't regenerated BUILD files and `deps.bzl`.

**Check:**
- After `go.mod` changes, was `gazelle update-repos` run?
- Do BUILD file `deps` match what's imported in Go source?
- Is `go_repository` in `WORKSPACE` up to date with `go.sum`?
- Run `bazel run //:gazelle` and check for diff

### 6. Using genrule When a Proper Rule Exists

**Problem:** `genrule` is a last resort — it's not hermetic, not cacheable, and hard to maintain.

```python
# ❌ BAD: Using genrule for protobuf generation
genrule(
    name = "gen_proto",
    srcs = ["service.proto"],
    outs = ["service.pb.go"],
    cmd = "protoc --go_out=. $(SRCS)",
)

# ✅ GOOD: Use the proper rule
load("@rules_proto//proto:defs.bzl", "proto_library")
load("@io_bazel_rules_go//proto:def.bzl", "go_proto_library")

proto_library(
    name = "service_proto",
    srcs = ["service.proto"],
)

go_proto_library(
    name = "service_go_proto",
    proto = ":service_proto",
    importpath = "example.com/service",
)
```

**Check:**
- Is `genrule` used where a proper rule exists?
- Are shell commands in `genrule` hermetic (no network, no host tools)?
- Could the `genrule` be replaced with a custom rule (`.bzl` macro)?

### 7. Missing or Incorrect load Statements

**Problem:** Using rules from the wrong repository or missing load statements.

```python
# ❌ BAD: Missing load statement
go_library(  # Error: go_library is not defined
    name = "mylib",
    srcs = ["main.go"],
)

# ✅ GOOD: Explicit load
load("@io_bazel_rules_go//go:def.bzl", "go_library")

go_library(
    name = "mylib",
    srcs = ["main.go"],
    importpath = "example.com/mylib",
)
```

**Check:**
- Are all rules loaded from the correct external repositories?
- Are load statements at the top of the BUILD file?
- Are unused loads removed?

## BUILD File Hygiene

### Ordering Convention

```python
# 1. load() statements (sorted)
load("@io_bazel_rules_go//go:def.bzl", "go_binary", "go_library", "go_test")

# 2. package() declaration (if needed)
package(default_visibility = ["//visibility:private"])

# 3. Library targets
go_library(
    name = "mylib",
    srcs = ["lib.go"],
    importpath = "example.com/mylib",
)

# 4. Binary targets
go_binary(
    name = "mybinary",
    embed = [":mylib"],
)

# 5. Test targets
go_test(
    name = "mylib_test",
    srcs = ["lib_test.go"],
    embed = [":mylib"],
)
```

### Naming Conventions

- Library targets: match the package directory name
- Binary targets: match the command name
- Test targets: `<library>_test`
- Proto targets: `<name>_proto`, `<name>_go_proto`, `<name>_java_proto`

### Buildifier

Always run `buildifier` on BUILD files. Check:
- Is buildifier configured in CI?
- Are BUILD files formatted consistently?

## Testing in Bazel

### Running Tests

```bash
# Run all tests
bazel test //...

# Run tests in a specific package
bazel test //path/to/package:all

# Run a specific test
bazel test //path/to/package:my_test

# Run with verbose output
bazel test //path/to/package:my_test --test_output=all

# Run affected tests (with query)
bazel test $(bazel query 'rdeps(//..., set(changed_files))' --keep_going)
```

### Test Size and Timeout

```python
go_test(
    name = "integration_test",
    srcs = ["integration_test.go"],
    size = "large",      # small, medium, large, enormous
    timeout = "long",    # short, moderate, long, eternal
    tags = ["integration"],
)
```

**Check:**
- Are test sizes appropriate? Unit tests should be `small`, integration `medium` or `large`
- Are timeouts set for slow tests?
- Are integration tests tagged so they can be filtered?

## Review Checklist

### Dependencies
- [ ] `deps` contains only compile-time dependencies
- [ ] `runtime_deps` used for runtime-only dependencies
- [ ] `data` includes all test data files
- [ ] No unnecessary dependencies (bloating the build graph)

### Visibility
- [ ] `//visibility:public` is justified (not used by default)
- [ ] Internal targets are scoped to package/subpackages
- [ ] API surface matches visibility grants

### Glob Patterns
- [ ] Library globs exclude test files
- [ ] Globs are scoped to the right directories
- [ ] No accidental inclusion of generated files

### Build Hygiene
- [ ] `load()` statements are sorted and from correct repos
- [ ] Unused loads are removed
- [ ] Targets follow naming conventions
- [ ] BUILD files are formatted with buildifier

### Gazelle (Go projects)
- [ ] BUILD files are in sync with Go imports
- [ ] `go_repository` matches `go.sum`
- [ ] `gazelle update-repos` was run after `go.mod` changes

### Testing
- [ ] Test sizes are appropriate
- [ ] Test data is declared in `data` attribute
- [ ] Integration tests are tagged
- [ ] Timeouts set for slow tests

## Common Anti-Patterns to Flag

1. **Mega-targets**: Single BUILD target with 100+ source files (should be split)
2. **Diamond dependencies**: Same library reached through multiple paths (causes build slowness)
3. **Host tool usage**: `genrule` calling `/usr/bin/python` (not hermetic)
4. **Missing tags**: Integration/E2E tests not tagged → slow CI
5. **Stale deps**: Dependencies listed that aren't actually imported
6. **Public visibility on internal code**: Defeats the module boundary system

## References

- [Bazel Documentation](https://bazel.build/docs)
- [Bazel Best Practices](https://bazel.build/configure/best-practices)
- [Gazelle](https://github.com/bazelbuild/bazel-gazelle)
- [Buildifier](https://github.com/bazelbuild/buildtools/tree/master/buildifier)
