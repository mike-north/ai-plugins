# Toolsmith lint rule concepts

Mike North · 2026-07-15 · Status: concepts, pending eslint-sh

These are the Toolsmith-specific rules that make up the **forge rule pack** — the opinionated layer of the proposal gate. They are written as *concepts*, not implementations: **eslint-sh, the standalone shell-linting project these rules will run on, is not built yet.** Until it exists, these concepts serve as its steel threads — each rule is a concrete, end-to-end demand on the framework (AST shapes it must expose, config it must plumb, fix capabilities it must support) that keeps eslint-sh's design honest against a real consumer.

Two scoping notes. First, generic shell-quality rules (strict-mode presence, quoting discipline, dynamic-invocation bans, secret hygiene, interactivity detection, bash-version construct restrictions — including the macOS bash 3.2 compatibility pack) belong to **eslint-sh itself**, not this pack; this doc covers only rules that reference Toolsmith conventions. Second, the pack versions in lockstep with the forge runtime it describes, in the Toolsmith repo, so a convention change is one PR — never a cross-repo release dance.

The purpose of the pack, stated once: mechanically guarantee that **the contract header tells the truth**, so the human signing moment concentrates on the one question machines can't answer — *do I want an agent to have this capability?*

## The rules

**`contract-header-present`** — Every forged tool begins with a well-formed contract header: purpose, inputs, side-effect class, guards, exit-code map, dependency declarations, runtime version pin, timeout ceiling. Missing or malformed header fails the gate. *Steel-thread demand: comment/structured-block parsing adjacent to the AST, not just node visitors.*

**`require-declares-usage`** — Every non-ubiquitous command invoked anywhere in the script (through pipelines, subshells, command substitutions, `xargs`/`find -exec` indirection) has a matching `forge::require` line. Used-but-undeclared: error. Declared-but-unused: warning (stale requirement surviving a refactor). The "assumed ubiquitous" allowlist is the POSIX floor and is shared with the manifest tooling. *Steel-thread demand: reliable `CallExpr` extraction that sees through indirection and ignores strings/heredocs/comments.*

**`side-effect-honesty`** — The header's declared side-effect class must be consistent with the script body. `side-effects: none` plus `gh pr merge`, `curl -X POST|PUT|DELETE`, `git push`, `rm`, or other mutating invocations: error. Heuristic and deny-list-driven — it will not catch everything, but it catches the accidental mismatch, which is the common case, and the vaultkeeper grant defaults (read tools get cheap grants) make this class worth defending. *Steel-thread demand: flag/argument inspection on call expressions, not just command names.*

**`timeout-discipline`** — Invocations that can block on external state (network commands, `ssh`, `git` remote operations, `op`, lock acquisition — deny-list, extensible) must be wrapped in `with-timeout`, and the tool's declared timeout ceiling must be present in the header. *Steel-thread demand: parent/ancestor queries ("is this CallExpr inside a `with-timeout` invocation?") — a natural esquery selector test case.*

**`exit-code-map-integrity`** — Exit codes used by the script (via `exit N`, `forge::fail N`, `forge::guard ... N`) and codes declared in the header's map must agree in both directions. Undeclared code used: error. Declared code never reachable: warning. Codes inside the runtime's reserved band: error. *Steel-thread demand: literal extraction plus light data-flow (constants assigned then used).*

**`runtime-pin-and-prelude`** — The runtime version pin is present in the header, the prelude is sourced before any other statement, and `is-agent` / `emit` / `help-formatter` are used rather than hand-rolled TTY checks, output assembly, or help text. Hand-rolled equivalents: error, pointing at the helper. This is the rule that keeps tools thin and reviewed logic centralized.

**`docs-drift`** — When a `<tool>.md` exists, its generated front-matter (contract summary, exit codes) must match the script's contract header. Disagreement fails the gate; the fix is regeneration, which the curator applies mechanically. *Steel-thread demand: a rule that can consult a sibling file — cross-file context via settings or a service, a deliberate stretch case for eslint-sh's design.*

**`confirm-for-severe`** — Tools whose header declares a severe mutating action must accept and verify `--confirm=<target>` restating the target object. Severe action with no confirm plumbing: error.

**`rationale-for-authority`** — Tools of the authority archetype (declared in the header) must require a `--rationale` argument and pass it into the externally visible record (e.g. the check-run summary). Authority archetype without rationale plumbing: error.

**`composition-declares-inputs`** — A tool that invokes another forged tool must declare that consumption in its contract header (the curator's composition graph depends on it), and the inner invocation must use `--format json` — TOON is never an interchange format. *Steel-thread demand: distinguishing forged-tool invocations from ordinary commands, via the toolbox manifest supplied as rule context.*

**`no-inline-config`** — Whole-file linter configuration from inside a script is forbidden (ESLint's `noInlineConfig` posture); only per-rule disables are allowed, and every disable must carry a reason: `# forge-lint: disable=<rule> -- <reason>`. Reasonless disables: error. Unused disables: error (ESLint's unused-directive reporting). The escape hatch is a feature — every exception is visible inside the hashed script, so an agent can bypass a rule only *in writing*, where the signer will read it.

## Severity philosophy

Errors block eligibility for human review — a proposal that fails the gate is returned to the curator, never to the human. Warnings surface in the review UI but don't block; they exist for drift that's plausible-but-suspicious (declared-but-unused deps, unreachable exit codes). Nothing in the pack is auto-fix-silent: fixes the curator applies (regenerating docs front-matter, inserting a missing `forge::require`) appear in the proposal diff the human signs.

## Relationship to eslint-sh, restated

Dependency points one way: this pack imports eslint-sh's language plugin and rule APIs; eslint-sh never learns that Toolsmith, `forge::require`, `with-timeout`, or vaultkeeper exist — its generic analogues (a pluggable "declaration convention" interface, a configurable "must-be-wrapped" rule) are the extension points this pack binds to Toolsmith vocabulary. If a "generic" eslint-sh rule ever mentions a Toolsmith concept, the boundary has failed.
