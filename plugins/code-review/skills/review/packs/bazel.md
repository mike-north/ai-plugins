---
pack: bazel
loads_into: [generalist]
verified: "2026-07"
sources:
  - https://bazel.build/configure/best-practices
  - https://github.com/bazelbuild/bazel-gazelle
  - https://github.com/bazelbuild/buildtools/tree/master/buildifier
verify: "Check the repo's actual BUILD/BUILD.bazel files and WORKSPACE/MODULE.bazel setup — rules and load-statement paths vary by which rule sets (rules_go, rules_proto, ...) are vendored."
---

# Bazel

## Facts to check against

- **`deps` vs. `runtime_deps`.** `deps` are compile-time dependencies; a runtime-only dependency
  (e.g. reached only via reflection) placed in `deps` forces unnecessary rebuilds when it changes —
  it belongs in `runtime_deps` instead.
- **Overly broad `visibility`.** `//visibility:public` on an internal-implementation target
  defeats the purpose of module boundaries — prefer `//pkg:__subpackages__` or an explicit
  allowlist, reserving `public` for genuine cross-cutting API targets.
- **Missing `data` for test fixtures.** A test that reads files from disk without declaring them
  in `data` will fail (or silently read nothing) under Bazel's sandboxed test execution.
- **Glob patterns too broad.** `glob(["*.go"])` in a library target that doesn't `exclude
  = ["*_test.go"]` pulls test files into the library; `glob(["**/*.java"])` with no directory scope
  can pull in generated code unintentionally.
- **Gazelle out of sync (Go projects).** After a `go.mod`/`go.sum` change, `gazelle
  update-repos`/`bazel run //:gazelle` should have regenerated BUILD files and `deps.bzl` —
  `deps` in BUILD files that don't match actual Go imports is a signal this step was skipped.
- **`genrule` used where a proper rule exists.** `genrule` is not hermetic or well-cacheable —
  reach for it only when no purpose-built rule exists (e.g. use `go_proto_library` for protobuf
  code generation, not a `genrule` shelling out to `protoc`).
- **Missing or misplaced `load()` statements.** Rules must be loaded from the correct external
  repository at the top of the BUILD file; unused loads should be removed.
- **Test size/timeout.** `size` (`small`/`medium`/`large`/`enormous`) and `timeout`
  (`short`/`moderate`/`long`/`eternal`) should match the actual test's runtime — a slow integration
  test left at the default `small` risks spurious timeouts; tag integration/E2E tests so they can
  be filtered out of a fast local test loop.
- **BUILD file formatting.** `buildifier` should be run (ideally enforced in CI) so BUILD files
  stay consistently formatted.
