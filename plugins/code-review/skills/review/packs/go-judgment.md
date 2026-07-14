---
pack: go-judgment
loads_into: [go]
verified: "2026-07"
sources:
  - https://go.dev/doc/tutorial/generics
  - https://pkg.go.dev/sync#Pool
  - https://go.dev/doc/comment
verify: "Check the repo's go.mod Go version — generics require 1.18+; a project pinned below that has a real reason to use interface{}/any instead."
---

# Go judgment (beyond error handling/goroutine safety)

## Facts to check against

- **`interface{}`/`any` with type assertions where generics (Go 1.18+) would be type-safe.** A
  function like `func Contains(slice []interface{}, item interface{}) bool` forces every caller to
  box values and loses compile-time type checking; on a Go 1.18+ module, `func Contains[T
  comparable](slice []T, item T) bool` catches type mismatches at compile time and avoids the
  boxing allocation. Not every `any` is wrong — genuinely heterogeneous data (JSON of unknown
  shape) still needs it.
- **`sync.Pool` used without resetting object state on `Get`.** A pooled object may carry data
  from its previous use — `buf := pool.Get().(*bytes.Buffer)` followed directly by a write without
  `buf.Reset()` first can leak previous-request data into the current one. Always reset
  pooled-object state immediately after `Get`, before first use.
- **Test assertion libraries (testify, etc.) called from inside a spawned goroutine.**
  `go func() { assert.Equal(t, want, got) }()` is unsafe — `testing.T` isn't safe for use from a
  goroutine other than the one running the test, and a failure there can be lost or panic
  outside the test's recover machinery. Use `require.Eventually(t, func() bool {...}, timeout,
  interval)` to poll for the condition on the test goroutine instead.
- **`range` iterating a slice of large structs by value.** `for _, item := range items` where
  `item` is a large struct (many fields, embedded arrays) copies the full struct on every
  iteration. `for i := range items { process(&items[i]) }` avoids the copy when the loop body only
  reads or needs a pointer — worth flagging only when the struct is genuinely large or the loop is
  hot.
- **Exported symbols missing doc comments, or comments that don't start with the symbol name.**
  `go doc`/`pkg.go.dev` render a symbol's leading comment as its documentation only when the
  comment is a complete sentence starting with the symbol's own name (`// Users returns all active
  users.` not `// This returns all active users.`) — a doc comment in the wrong form is silently
  dropped from generated documentation, not just poorly styled.
