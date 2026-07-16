# Toolsmith design patterns for forged tools

Mike North · 2026-07-15

This is the baseline ruleset the curator enforces when forging or refactoring tools, and the reference the proposal gate's lint rules mechanize (see [lint rule concepts](./lint-rule-concepts.md)). Users may supplement these patterns with their own; the curator treats user-supplied patterns as additive unless they conflict, in which case the user's win.

Provenance: mined from [clig.dev](https://clig.dev/) and re-derived for our priority order — agents first, composability second, refactorability third, humans secondary-but-present. clig's central premise is that the modern CLI is *human-first*; forged tools invert that premise, so every guideline below was re-evaluated rather than adopted wholesale.

## Foundations (adopted from CLI tradition, unchanged)

**Exit codes are the contract.** Zero on success; distinct non-zero codes mapped to the most important failure modes, declared in the contract header. For precondition tools, one named code per guard (`3` = unresolved review threads, `4` = CI red, …) so agents and hooks branch on failure class without parsing prose. Timeout expiry gets its own code, distinct from any guard, because "the world stalled" and "the guard failed" want different agent reactions (retry/escalate vs. fix).

**stdout is data; stderr is messaging.** Machine-consumable output goes to stdout only. Errors, guidance, and did-you-mean suggestions go to stderr, so pipelines stay clean and agent-directed feedback has a dedicated channel.

**Flags over args; long flags only.** Positional arguments are reserved for the single, obvious primary object (a PR number). Everything else is a long flag. Agents don't have typing hands to save; `--format json` self-documents in the transcript, and long-only flags keep the interface additive-forever without positional ambiguity.

**Standard flag names where standards exist.** `--dry-run`, `--force`, `--json`, `--quiet`, `--output`, `--all`, `--help`, `--version`. Semantic activation applies to flags: an agent has seen `--dry-run` a million times in training and needs no docs to use it correctly.

**Validate early, fail legibly.** Every error message is a retry prompt: what failed, why, and the corrected invocation or next action. clig's "errors are documentation" is literally true when the reader is an agent.

**Confirmation for dangerous operations is scriptable, and the scriptable form is primary.** Severe actions require `--confirm=<name-of-target>` — forcing the agent to restate the target is cheap defense against acting on the wrong object. Interactive y/n prompts do not exist (see Rejections).

**No secrets via flags or environment variables.** Command lines land in transcripts and post-hook logs. Secrets travel via files, stdin, or vaultkeeper — never a `--token` flag, never a `*_TOKEN` env read inside a tool.

**Future-proofing rules, all of them.** Order-independent flags; no catch-all subcommand; no arbitrary abbreviations; additive changes preferred; warn before non-additive changes. These are cheap and align with the curator's continuous-refactor posture.

**Robustness: crash-only, idempotent-or-labeled, timeouts by default.** Agents retry aggressively; crash-only tools make retries safe. Read-only tools are unmarked; mutating tools declare it in name, `--help`, and contract header — which also gives vaultkeeper a natural default axis (read tools get cheap indefinite grants; mutating tools default to time-boxed).

## Agent-first inversions (adopted from clig, defaults flipped)

**Structured output is paramount; human rendering is the detected special case.** Default output is TOON (token-efficient, at-least-as-parseable-as-JSON for agents) on the terminal hop. `--format json|toon` is universal; JSON is the *only* interchange format between composed tools — TOON is a rendering, never mid-pipeline. The TTY heuristic inverts: if stdout *is* an interactive terminal, a human is probably poking at the tool — render prettily. The SDK's `is-agent` helper (harness env vars first, TTY as fallback) is the single source of truth; tools never hand-roll detection.

**The above-the-fold rule.** Most harnesses show the first ~3–4 lines of tool output in the human-facing chat. That area is the human's window into an autonomous loop. Mutating tools lead with one plain, human-legible state line — `merged PR #482 → main (a2a5217)` — before the structured payload. Judicious ANSI color in those lines is acceptable (a red ✗ on a guard failure catches the human eye; agents strip escapes without cost). Below the fold: no color, no decoration.

**Quiet success, but state changes announce themselves.** No output on success is the default for reads. Mutations emit exactly the above-the-fold state line plus the structured result the agent needs (the merge SHA, not reassurance).

**Help is a token-priced artifact.** `--help` always works; bare invocation with missing required args prints concise help and exits non-zero. Content order: realistic examples first (agents pattern-match from examples better than from flag tables), then flags, then the named exit-code map, then `SEE ALSO` listing sibling tools in the same prefix group (cheap cross-discovery). Rendering goes through the SDK's `help-formatter`: TOON-structured for agents, bold headings for humans, same source. No web links, no pagers on the agent path.

**Did-you-mean, without DWIM.** A near-miss invocation gets a non-zero exit and `did you mean: <corrected invocation>` on stderr — computed by the SDK helper against the toolbox manifest — and is never auto-executed. Auto-correcting teaches the agent the wrong syntax and commits us to supporting it; worse, an unhandled miss risks the agent falling back to the raw dangerous command, which is the actual failure to prevent.

**Naming optimizes semantic activation, not typing hands.** Lowercase and dashes; descriptive over short — `gh-review-comments`, never `ghrc`. The prefix is the dangerous command the tool retires: a tool orchestrating `gh` + `jq` + `toon` is a `gh-*` tool, named for the danger it wraps, not the pipeline it contains. The prefix group is a discovery construct (catalog sections, `SEE ALSO`, hook matchers).

**Configuration: XDG paths, standard precedence, profile-aware.** Toolbox, manifest, and grants live under XDG base directories (dotfile-manager friendly; chezmoi `run_onchange_` hooks can trigger the bootstrap preflight when the manifest changes). Precedence: flags > env > project config > user config. The **environment profile** (bash version, installed dependencies, OS) is user-level; per-repo policy (e.g. "emoji reactions are semantic in this repo") is project-level and version-controlled. Profile changes shape *future* proposals only — signed tools are pinned by hash and untouched.

## Rejections (clig guidance we deliberately drop)

**Interactivity, entirely.** Every forged tool behaves as if `--no-input` were permanently set: a prompt would deadlock an agent, so missing input fails fast with the flag that should have been passed. A human-only prompt may exist strictly behind TTY detection, never on any required path.

**Progress theater.** No spinners, progress bars, pagers, ASCII-art density, or emoji decoration. All token pollution. "Responsive in <100ms" is replaced by real timeout discipline (below) — agents don't get nervous, they get exit codes.

**Analytics.** The telemetry triangle (invocations + outputs, redirects, asks) is local, load-bearing product surface for curation — not opt-in metrics.

## Forge-specific patterns (no clig analogue)

**The contract header.** The first ~15 lines of every tool, inside the hashed content: purpose (one line), inputs, side-effect class (`none` | `read` | `mutate`), guards enforced, exit-code map, `forge::require` dependency lines, SDK version pin, timeout ceiling. One authored artifact, four consumers: the signing review surface, the `--help` source, the catalog entry source, and the curator's refactor index. It must be inside the hash so the thing reviewed is the thing that runs — contract/code drift is structurally impossible.

**`<tool>.md` documentation, unsigned by design.** Extended examples, rationale ("why we check non-required CI too"), composition recipes. Capability lives entirely in the signed script's guards, so docs can mislead an agent into inefficiency but cannot expand what the tool will do — sign what executes, don't sign what describes. This keeps doc polish frictionless (no re-approval cascade). The curator regenerates the `.md` front-matter from the contract header; the proposal gate fails on disagreement.

**`--explain`.** Print the contract — guards, what would be checked, exit codes — without executing. Cheaper than `--dry-run` for reads; it's how an agent disambiguates two similar tools without burning a real invocation. `--dry-run` additionally evaluates guards against live state without acting, where feasible.

**Timeout discipline is mandatory, not advisory.** Any invocation that can block on external state — network, ssh-agent, `op` waiting for a human tap, lock acquisition — goes through the SDK's `with-timeout`, with the ceiling declared in the header. (macOS ships no `timeout` coreutil; the SDK helper exists so stock-Mac bash-3 tools don't reimplement the background-and-kill pattern badly.)

**Guards run inside the tool, atomically.** Precondition checks are never delegated to agent-side reasoning before the call — that opens a time-of-check/time-of-use gap. The tool re-verifies everything at invocation, adjacent to the action.

**Composition discipline.** Tools compose via `--format json` on stdout; a tool that consumes another forged tool's output declares that dependency in its contract header, so the curator sees the composition graph when refactoring. The final hop renders TOON; agents pay the token cost exactly once, at the point of consumption.

**Language choice: shell first, thin always.** Tools are bash (PowerShell reserved for a future Windows story) — no Node/Python startup tax for what are mostly compositions of existing CLIs, and a 40-line shell script is a reviewable signing surface in a way a Node project never is. Default compatibility target is macOS stock bash 3.2 (no associative arrays, no `mapfile`, no `${var,,}`, no negative array indices); the environment profile may declare Homebrew bash 5 and relax this for future forges. When bash-3 makes data structures painful, the answer is "push the logic into `jq`," not clever parallel-array workarounds — shell stays thin orchestration; transformation lives in tools built for it. Scripts assert their own floor at the top (`BASH_VERSINFO` check with a legible error) so a bash-5 tool fails loudly, line 1, on a stock Mac.

**Dependencies are executable declarations.** `forge::require jq '>=1.6'` at the top of the script is simultaneously the static declaration the linter verifies, the runtime preflight (legible failure before any logic runs), and the harvest source for the machine-installable manifest. Names-only by default; a minimum version only when a version-gated feature is actually used, annotated with why and by which tool, so the constraint can be retired when its reason disappears. The "assumed ubiquitous" floor (POSIX basics: `grep`, `sed`, `awk`, `cut`) is the one exempt set — everything else must be required.
