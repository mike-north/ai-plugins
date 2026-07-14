---
pack: eslint-rule-authoring
loads_into: [typescript]
verified: "2026-07"
sources:
  - https://typescript-eslint.io/developers/custom-rules
  - https://eslint.org/docs/latest/extend/custom-rules
  - https://eslint.org/docs/latest/integrate/nodejs-api#-ruletester
verify: "Check the repo's existing custom rules (if any) for its established messageId/meta/test conventions before flagging a new rule for deviating."
---

# ESLint rule authoring (`@typescript-eslint/utils`)

## Facts to check against

- **`RuleCreator` over a bare rule object.** `ESLintUtils.RuleCreator(name => url)` wires up a
  `docs.url` automatically and gives consistent `meta` shape — a hand-rolled rule object that
  skips it usually means `meta.docs.url` is missing or wrong.
- **`messageId`s, not inline message strings.** Reporting via `context.report({ messageId:
  'noFoo', data: {...} })` against a `meta.messages` map keeps messages translatable/testable and
  lets `RuleTester` assert on the id rather than fragile string matching. A rule using
  `context.report({ message: '...' })` directly (no `messageId`) is a regression from this
  convention.
- **`getParserServices` guard for type-aware rules.** Any rule that needs type information
  (`services.program.getTypeChecker()`, `services.getTypeAtLocation(node)`) must call
  `ESLintUtils.getParserServices(context)` first — this throws a clear, actionable error if the
  rule is used without `parserOptions.project` configured, instead of failing with a confusing
  `undefined` deep inside the rule body.
- **`meta.schema` completeness.** Any rule accepting options must declare a JSON Schema in
  `meta.schema` — an option read from `context.options[0]` with no matching schema entry means
  ESLint won't validate user-supplied config, and a typo'd option silently does nothing.
- **`meta.docs` completeness.** `description`, `recommended` (or the rule's inclusion in a named
  config), and `url` should all be present — a rule with an empty `docs` object is undiscoverable
  in generated documentation.
- **Safe fixer vs. suggestion.** A `fix` function (returned as part of `context.report({ fix:
  ... })`) is applied automatically by `--fix` and must be behavior-preserving with no room for
  ambiguity. If the transformation could change program behavior or requires picking between
  multiple valid rewrites, it belongs in `suggest` (a `SuggestionOutput`, applied only by explicit
  user action in an editor), not `fix`. A rule using `fix` for something semantically ambiguous is
  a correctness risk for anyone running `--fix` in CI.
- **`RuleTester` coverage.** New/changed rules need both `valid` and `invalid` test cases. Every
  `invalid` case should assert on `errors: [{ messageId: '...' }]` (not just that *an* error
  occurred). Any rule with a `fix` or `suggest` needs a matching `output`/`suggestions` assertion
  in its `invalid` test case — an `invalid` case with no `output` field silently skips verifying
  what the fixer actually produces.
- **Rule naming and file layout consistency.** Check the repo's existing rules for its naming
  convention (kebab-case rule ids, a matching `docs/rules/<name>.md`, test file colocated or in a
  parallel `tests/` tree) and flag a new rule that diverges without a stated reason.
