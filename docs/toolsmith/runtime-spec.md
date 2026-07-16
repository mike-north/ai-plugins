# Toolsmith forge runtime spec

Mike North · 2026-07-15 · Status: draft specification

The **forge runtime** (working name; "SDK" informally) is the signed, versioned bundle of shared shell helpers that every forged tool sources. It exists so that reviewed logic lives once, tools stay thin (guards over trusted primitives), and the signing surface per tool stays small. This doc specifies the runtime's components, their contracts, and the lifecycle rules that keep the trust story intact.

Related: [design patterns](./design-patterns.md) (the rules these helpers implement), [lint rule concepts](./lint-rule-concepts.md) (how the proposal gate verifies usage).

## Scope and hard boundaries

- The runtime is **pure shell**, targeting the same compatibility floor as the tools (stock macOS bash 3.2 unless the environment profile raises it). Forged tools remain runtime-free at invocation: no Node, no Python on the execution path.
- TypeScript/Node components of Toolsmith (the proposal gate, curation, codemods, manifest tooling) live strictly on the **forge-time path** and are dependencies of the *plugin*, never of any tool.
- The runtime is a **signed artifact** with a version. Every tool pins its runtime version in its contract header. See Lifecycle.

## Components

### 1. Prelude (`forge-prelude.sh`)

Sourced by every tool, first line after the shebang and contract header. Responsibilities:

- Strict mode (`set -euo pipefail`) and safe IFS.
- Bash floor assertion: check `BASH_VERSINFO` against the tool's declared floor; on failure, exit with the runtime's reserved exit code and a legible one-line error naming the required version and how to get it.
- Standard error formatting: a single machine-readable error line on stderr (`error: <code-name>: <message>; try: <corrected invocation or next action>`), used by all helpers and available to tools as `forge::fail <exit-code> <message>`.
- Runtime version self-identification (`forge::runtime_version`), so tools and the gate can verify the pin.

### 2. Dependency declaration (`forge::require`)

`forge::require <command> ['<version-constraint>']`

- Executes at tool start: `command -v` check, then version comparison when a constraint is present, using the runtime's single version-compare implementation (semver-ish, tolerant of common `--version` formats; per-command extraction quirks live here, in one place).
- On failure: legible error naming the missing/outdated command and the install command (Homebrew line when the manifest knows it), reserved exit code.
- Statically, the same line is the declaration the proposal gate verifies (used-but-undeclared fails; declared-but-unused warns) and the harvest source for the dependency manifest.
- Convention: names-only unless a version-gated feature is actually used; constraints carry an annotation in the contract header — *which tool, which feature* — so they can be retired when the reason disappears (e.g. `op >= 2.x-beta — required for op run --environment`).

### 3. Agent detection (`is-agent`)

Single source of truth for "is my consumer an agent?" In the spirit of [is-agentic-tui](https://github.com/mike-north/is-agentic-tui): check known harness environment variables (e.g. `CLAUDECODE`, plus the maintained list for other harnesses), fall back to TTY state. Harness signatures change; this knowledge updates in one signed place, never per-tool.

### 4. Output formatting (`emit`, `emit-summary`, `--format` plumbing)

- `--format json|toon` handling: default TOON when `is-agent`, pretty when a human TTY, JSON always available; explicit flag always wins. JSON is the only interchange format between composed tools — TOON is terminal-hop rendering only.
- `emit-summary` implements the above-the-fold rule: mutating tools emit one plain human-legible state line (judicious ANSI permitted here and only here) before the structured payload.
- Structured emission helpers so tools don't hand-assemble TOON/JSON.

### 5. Timeout enforcement (`with-timeout`)

`with-timeout <seconds> <command...>`

- Portable background-and-kill implementation (macOS has no `timeout` coreutil; this must not assume GNU coreutils).
- On expiry: kills the process group, emits a legible error, exits with the runtime's reserved **timeout exit code** — distinct from every guard code, because "the world stalled" (retry/escalate) and "the guard failed" (fix) demand different agent reactions.
- Required (lint-enforced) around anything that can block on external state: network, ssh-agent, `op` human-tap waits, lock acquisition. The ceiling is declared in the contract header.

### 6. Did-you-mean (`forge::suggest`)

Word-distance (Levenshtein) match against the toolbox manifest for near-miss tool or flag names. Emits `did you mean: <corrected invocation>` on stderr with a non-zero exit. **Never auto-executes** the correction. Exists to keep a typo from routing the agent back to the raw dangerous command.

### 7. Help rendering (`help-formatter`)

Renders `--help` from the contract header: TOON-structured for agents, bold headings for humans, same source, switched by `is-agent`. Content order per the design patterns: examples → flags → exit-code map → `SEE ALSO` (sibling tools in the prefix group). Also the renderer behind `--explain` (contract without execution).

### 8. Guard helpers (`forge::guard`)

Thin conveniences for precondition tools: run a check, and on failure emit the named error and exit with the guard's declared code. Keeps the guard→exit-code mapping mechanical and lintable.

## The dependency manifest and bootstrap preflight

- The manifest is a machine-readable inventory harvested from `forge::require` lines across the toolbox: command name, optional annotated minimum version, originating tool(s).
- **Preflight runs at bootstrap time** — dotfiles sync / plugin install / new-machine setup — never per invocation. chezmoi integration: the manifest is a versioned artifact; a `run_onchange_` script triggers preflight when it changes, so new dependencies propagate across machines automatically.
- Preflight reports two failure tiers: *missing entirely* (blocking; emit the consolidated `brew install` line) and *present but too old* (blocking only for the tools that declared the constraint — partial degradation: "everything works except `vaultkeeper-env-inject` until you upgrade `op`").
- When the curator wants a dependency that isn't installed, the ask happens at **proposal time** ("this tool wants `yq`; approve the dependency along with the tool?") and lands in the manifest so future machines inherit it.

## The environment profile

User-level configuration, auto-detected with user override: bash version (stock 3.2 vs. Homebrew 5+), installed dependency set, OS. Consumed by:

- The **curator**, to shape what it generates (bash-5 constructs allowed or not; which deps it may assume).
- The **proposal gate**, as lint configuration (the eslint-sh `languageOptions.bashVersion` option).
- Never the invocation path: signed tools carry their own floor assertions and are pinned by hash, so profile changes affect *future* proposals only — no re-approval cascade.

## Harness wrappers

Toolsmith supports (and treats as trusted, signable infrastructure) thin wrappers that establish ambient context before the harness runs: appending project-specific tool directories to `$PATH`, and scoped secret exposure via `op run --environment <environment_id>` so credentials exist for the agent process without floating in the global environment. Two invariants: the PreToolUse hook hashes the **resolved** script, so a PATH-shadowed imposter is just an unsigned file and falls through to `ask`; and the wrapper itself joins the signed set, because it shapes every tool's environment.

## Lifecycle, versioning, and trust

- The runtime is a **signed bundle with a version**. Tools pin it in their contract header. The tool's hash covers the tool's own content plus its declared runtime pin; the runtime's hash is verified independently at invocation.
- A runtime bump is **one human approval**; the curator then mechanically re-signs dependent tools (the diff a human reviews per tool is the pin line, plus any codemod applied). This resolves the shared-prelude tension deliberately: hashing only entrypoints would let behavior changes smuggle through the prelude; hashing resolved scripts naively would make every prelude edit a full re-approval cascade. Pinned-and-independently-verified is the middle path.
- The runtime is the designated **high-leverage refactor point** — fix error formatting once, every tool inherits on next re-sign — and therefore deserves the most careful review of anything in the system: every tool trusts it.
- The proposal gate's meaning is part of the trust story: eslint-sh, the Toolsmith rule pack, and the runtime are all **exact-pinned**; every bump is a deliberate curator event with human approval, because a signature attests "this tool passed *these* checks against *this* runtime."

## Reserved exit codes

The runtime reserves a small band (recommend 120–125) for its own failures so they never collide with tool guard codes: bash-floor violation, missing/outdated dependency, timeout expiry, format/usage error, contract violation detected at runtime. Guard codes are tool-local, start low (2+), and are declared in the contract header.

## Open items

- Exact serialization of the contract header (structured comment block vs. heredoc constant) — must be trivially parseable by the gate, the help formatter, and the harvest without a full shell parse.
- Whether `forge::guard` should support declared *guard ordering* so `--explain` output matches execution order mechanically.
- The reserved exit-code band needs a collision check against common conventions (e.g. 124 is GNU `timeout`'s code — possibly worth matching deliberately).
