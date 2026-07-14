---
pack: node-cli
loads_into: [cli-ux]
verified: "2026-07"
sources:
  - https://yargs.js.org/
  - https://github.com/tj/commander.js
verify: "Check the repo's package.json for which of yargs/commander (and which major version) is actually used before citing a version-specific API."
---

# Node CLI frameworks (yargs & Commander)

## yargs

- **Missing `.strict()`.** Without it, an unrecognized flag (a typo like `--verbos`) is silently
  ignored instead of erroring — every yargs setup should call `.strict()` unless there's a
  specific reason to accept unknown options.
- **Missing explicit `type`.** An option with no `type` is coerced to a string — `--count 10`
  becomes `argv.count === "10"`, and a numeric comparison against it silently misbehaves. Every
  option should declare `type: 'boolean' | 'number' | 'string' | 'array'`.
- **Missing `.demandCommand()`** on a subcommand-based CLI lets the tool be invoked with no
  subcommand and exit 0, when it should require one.
- **Default error formatting.** Without a `.fail((msg, err, yargs) => ...)` handler, validation
  errors show a full stack trace instead of a clean, actionable message.
- **Middleware that mutates `argv` without validation.** A `.middleware()` callback that reads a
  file or parses JSON should catch and rethrow with a clear message, not let a raw parse error
  surface to the user.
- **Missing `.completion()`** for a CLI meant for interactive/shell use.
- **Positional arguments with no validation in the builder function** — `choices`/`type` on
  `.positional()` catches bad values before the handler runs, rather than throwing deep inside
  business logic.

## Commander.js

- **Async `.action()` handlers with no error handling.** An `async` action callback that throws
  produces an unhandled promise rejection unless wrapped in try/catch (or the program uses
  `.exitOverride()` plus `.parseAsync()` consistently).
- **`.parse()` used with async actions.** `.parse()` does not await an async action — the process
  can exit before the action completes. Async actions require `.parseAsync()`.
- **Option value parsers with no validation.** A custom parser (e.g. for `--port`) should validate
  the parsed value and `throw new commander.InvalidArgumentError(...)` on failure rather than
  silently returning `NaN` or an out-of-range number.
- **No `.exitOverride()` for testability.** Without it, Commander calls `process.exit()` directly
  on any parse error, which terminates a test runner process — `.exitOverride()` makes it throw
  instead, so tests can assert on the thrown error.
- **Missing `.version()`.** A CLI with no `--version` flag has no easy way for a user (or a bug
  report) to identify which release they're running.
- **`.showHelpAfterError()` omitted** — without it, a parse error gives no hint that `--help` would
  explain the correct usage.

## Shared UX concerns (both frameworks)

Help text, flag naming/scoping, error-message quality, and output formatting judgments belong to
the `cli-ux` lens itself, not this pack — this pack is facts about the two frameworks' APIs, not a
UX rubric.
