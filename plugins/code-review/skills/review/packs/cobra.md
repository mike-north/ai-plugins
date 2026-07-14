---
pack: cobra
loads_into: [go, cli-ux]
verified: "2026-07"
sources:
  - https://github.com/spf13/cobra
  - https://github.com/spf13/cobra/blob/main/user_guide.md
  - https://github.com/spf13/cobra/blob/main/shell_completions.md
verify: "grep for `cobra.Command{` usages and confirm the project's actual spf13/cobra version in go.mod/go.sum before citing a version-specific API."
---

# Cobra (Go CLI framework)

Commands form a tree (root command + subcommands). Flags are persistent (inherited by
subcommands, registered via `PersistentFlags()`) or local (registered via `Flags()`, only on that
command). `RunE` returns an error; `Run` does not.

## Facts to check against

- **`RunE` over `Run`.** `Run` forces `os.Exit`/panic for error handling, which bypasses `defer`
  cleanup and can't be tested by asserting a returned error. `RunE` errors propagate to
  `rootCmd.Execute()`'s return value.
- **`SilenceUsage`/`SilenceErrors`.** Without these set on the root command, Cobra prints usage
  and the error itself; if `main()` also prints the error returned from `Execute()`, it appears
  twice.
- **Flag scoping.** A flag needed by every subcommand belongs on `PersistentFlags()`; a flag
  specific to one command belongs on that command's own `Flags()`. A persistent flag that only one
  subcommand actually uses is a scoping bug.
- **Flag validation helpers.** `MarkFlagsMutuallyExclusive(a, b)`, `MarkFlagsRequiredTogether(a,
  b)`, and `MarkFlagsOneRequired(a, b)` exist and should be used instead of hand-rolled checks in
  `PreRunE` for these common cases.
- **`os.Exit` inside a command handler** bypasses `defer`-based cleanup and makes the handler
  untestable — return an error from `RunE` instead and let `main()` decide the exit code.
- **`Args` validation.** Built-in validators (`cobra.NoArgs`, `cobra.ExactArgs(n)`,
  `cobra.MinimumNArgs(n)`, `cobra.MaximumNArgs(n)`, `cobra.RangeArgs(min, max)`) should back any
  command that reads `args[i]` — indexing into `args` with no `Args` validator risks an
  out-of-bounds panic on missing input.
- **Completion.** A `completion` subcommand (or `cmd.Root().GenBashCompletion`/`GenZshCompletion`
  equivalents) should exist for a CLI meant for interactive use. `RegisterFlagCompletionFunc` and
  `ValidArgsFunction` provide dynamic completion for flags/arguments with a constrained value set.
- **Help text fields.** `Short` is a one-line description; `Long` is the detailed explanation;
  `Example` should show realistic invocations; `Use` should include argument placeholders
  (`deploy <environment>`) so the argument shape is visible without opening `--help`.
- **Command-tree depth.** Cobra supports arbitrary nesting, but conventionally keeps depth to
  ~2-3 levels (`tool noun verb`); flatter is more discoverable than `tool resource compute
  instances vm create`.

## Testable structure

A command's business logic is more testable when extracted from the `cobra.Command` wiring — a
struct holding the command's fields with a plain method doing the work, and a thin
`RunE`/`cmd.Flags().StringVar(...)` wiring function that constructs it. This lets tests call the
struct's method directly without going through Cobra's flag-parsing machinery.
