# The toolsmith CLI surface

Mike North · 2026-07-17

Companion docs: [Architecture steer](./architecture-steer.md), [Product framing and principles](./product-framing-and-principles.md), [Design patterns](./design-patterns.md), [Steering & gap-adjudication](./steering-adjudication.md). This is a v2 design extension: today, toolsmith's user-facing surface is three interactive slash commands (`/toolsmith:analyze`, `/toolsmith:approve`, `/toolsmith:list`); this doc specifies the CLI backbone those commands become thin wrappers over.

## Why a CLI now

Tool creation and modification are moving beyond interactive slash commands to **autonomous, headless,
one-off coding-agent calls.** A headless agent can run a shell command; it cannot invoke a slash
command. [Steering & gap-adjudication](./steering-adjudication.md)'s async tool-evolution dispatch —
the coder-grade model proposing a modification to a signed tool after a `gap` verdict, in its Tier 2
section — is exactly such a call, and it needs a CLI entry point to run against, not a slash command
it structurally cannot reach. That's where the two v2 design threads meet.

## Principle: the deterministic backbone

The CLI is the **deterministic backbone for repeatable operations** — not only things behind a trust
boundary. A verb belongs in the CLI when it is any of:

- **privileged** — must not be freehand (hashing, granting, presence-checking);
- **verifying** — the agent must not self-certify the result;
- **cross-cutting** — spans projects or scopes;
- **deterministic-rendering** — the result should be byte-identical every run, and the agent then
  relays it verbatim (**agent as conduit for deterministic output**, not agent as improviser).

It is **not** for generative authoring, which agents already do well through file editing.

**Motivating failure.** `plugins/toolsmith/commands/analyze.md` today has the agent freehand: step 1
tells it to "Read `.claude/toolsmith/history.jsonl`," step 2 to "Consider the shipped watchlist... plus
any project `.claude/toolsmith/config.json` overrides," step 3 to "Cluster and rank" by re-deriving
frequency and awkwardness from what it just read in prose. None of that inventory step is deterministic
— it's an agent re-scanning the same files and re-deriving the same facts differently each run, which
is determinism-where-you-want-it done as improv. `/toolsmith:list` already gets this partially right —
it shells out to `toolsmith-approve.mjs --verify` for hash-drift status rather than computing hashes by
hand — but the inventory and rendering around that call are still prose instructions, not a program.
The CLI fixes the freehand parts.

## What is deliberately NOT a CLI verb

**`new` / `modify`.** Authoring and editing tool *source* is agent **file-editing** against a
skill-provided skeleton — the registry-entry template and
`plugins/toolsmith/skills/toolsmith/references/authoring-checklist.md`'s Compound/Missing/Guarded/
Permission-scopable rubric already live in the skill and already govern this today (`analyze.md` step
4 applies that same checklist). A draft tool is inert: unsigned, ungranted, it does nothing —
`registry-schema.md`'s `status: draft` entries don't redirect and can't be invoked — so there is no
trust boundary to protect at authoring time, and marshalling a regex, an exit-code map, and a timeout
through a CLI just to stamp a template is friction with zero safety payoff. The only privileged part
of the lifecycle is **re-approval after any edit**, which is `approve`, below. This mirrors the two-
approvals split `product-framing-and-principles.md:29-36` already draws: authoring is free; the human
physical action gates existence, not drafting.

## Verbs

- **`approve`** — the one trust boundary. Hash-pins the script, records the usage grant, and (v2)
  requires vaultkeeper's **presence-gated signature** — a human physical action, per
  `product-framing-and-principles.md:33`'s "toolbox admission... requires a human physical action."
  Today's `/toolsmith:approve` slash command already drives this mechanically through
  `toolsmith-approve.mjs --dry-run` then a bare invocation on confirmation; the CLI verb is that same
  mechanism made directly callable. A headless or background agent **structurally cannot** satisfy
  presence — that is the feature the design relies on, not a limitation to work around.
- **`lint`** — the proposal gate: shellcheck plus the forge rule pack, plus header-body-hash agreement
  checks. This is cheap and non-privileged, requires no presence, so the authoring agent can iterate
  its freehand draft to green without ever spending a human tap to discover a lint error. `approve`
  runs the identical gate, fail-closed, as a precondition — never a second, looser check. Named `lint`,
  not `check`, because `check` already names the PreToolUse hook brain
  (`plugins/toolsmith/scripts/toolsmith-check.mjs`) and this verb *is* linting, not gating a live
  invocation. The rules it runs are the ones `lint-rule-concepts.md` specifies:
  `contract-header-present`, `require-declares-usage`, `side-effect-honesty`, `timeout-discipline`,
  `exit-code-map-integrity`, `runtime-pin-and-prelude`, `docs-drift`, `confirm-for-severe`,
  `rationale-for-authority`, `composition-declares-inputs`, and `no-inline-config`.
- **`list`** — deterministic inventory of the registry across both scopes, plus hash-drift status,
  emitted as verbatim-relay markdown. This is `/toolsmith:list`'s existing behavior — read both
  registries, call `toolsmith-approve.mjs --verify` (and `--verify --user`) for OK/DRIFTED/MISSING/
  draft status, render two scoped tables — made directly callable and its rendering made
  deterministic rather than prose-composed per run.
- **`analyze`** — cross-project. Deterministically inventories, via a **user-level index of project
  locations**, what exists, what is unapproved or drifted, usage and pattern density, and watched-but-
  uncovered commands, emitted as verbatim-relay markdown. Logs stay project-local and gitignored
  (`registry-schema.md`'s `history.jsonl` section); the index of *where those project logs live* is
  the only user-level bookkeeping this verb introduces. **Split:** the CLI emits the deterministic
  facts — the inventory, the clustering, the frequency counts — and the **agent** adds the rubric
  judgment on top (which candidates clear `authoring-checklist.md`'s bar, and a script sketch), the
  same judgment `analyze.md` steps 4–5 already ask for today. Deterministic where it should be,
  reasoning only where it adds value — the priority order
  `product-framing-and-principles.md:13` states first ("agent discovery, understandability, usability,
  and token efficiency") is exactly why the facts shouldn't cost tokens to re-derive every run.
- **hook-internal, not user-facing: `check` and `adjudicate`.** `check` is the existing PreToolUse
  brain (`toolsmith-check.mjs`); `adjudicate` is [Steering & gap-adjudication](./steering-adjudication.md)'s
  Tier 2 Haiku-class substitute check. Both are kept lean and separate from the general CLI dispatcher so the
  hot path never pays general-dispatch startup cost on every candidate Bash command — the concern #38
  raises in detail about the PreToolUse path's latency budget applies here directly: anything that adds
  process-spawn overhead to `check` or `adjudicate` is scoped by that issue's benchmark, not by this
  doc's general verb design.

## Output model: relay-markdown

A **relay-markdown** format whose contract is: the agent copies this verbatim into chat as the
completed result, with no reasoning added on top. This is distinct from the two other output shapes
`design-patterns.md:31` already specifies — **TOON** (token-efficient, meant for an agent to parse or
pipe onward) and **TTY-pretty** (rendered for a human sitting at a terminal). Relay-markdown is neither:
it's a third consumer, a human reading chat, but the content is produced deterministically by the CLI,
not composed by the relaying agent.

Slash commands (`list`, `analyze`) become **thin wrappers**: run the CLI verb, relay its markdown
verbatim. `analyze` additionally invites the agent's rubric layer on top, per the split above. This is
the direct fix for the motivating failure: the prose instructions in today's `analyze.md` and `list.md`
become "run this, show the output," not "read these files and compose a report."

## Contract-header ownership (semantics vs. form)

Not "the machine owns the header, the agent writes only the body" — the actual split is **semantics
vs. form**:

- **The agent owns the semantics** — `side-effects`, `guards`, `exit-codes`, `timeout`, `covers`,
  `invoke`, `purpose` — which appear in *both* the header (the declared contract) and the body (the
  implementation). `lint` verifies the two agree; that agreement is exactly what
  `side-effect-honesty` and `exit-code-map-integrity` (`lint-rule-concepts.md`) mechanize, and what
  `require-declares-usage` and `docs-drift` extend to dependencies and generated docs.
- **The machine owns the form** — the `@toolsmith-contract` marker, the canonical serialization the
  parser, `--help`, and the catalog all depend on, the prelude plus `forge::require`/`forge::guard`
  wiring, and the **SDK version pin sourced from the installed runtime** rather than typed by hand (no
  hardcoded version literals — the same reasoning `runtime-spec.md`'s Lifecycle section applies to
  runtime pins generally: "a runtime bump is one human approval; the curator then mechanically
  re-signs dependent tools").
- **The source of truth is the script itself.** The header lives inside the hash — "sign what
  executes, don't sign what describes," `design-patterns.md:57`'s framing for why `<tool>.md` is
  unsigned — because there is no separate spec artifact to drift from it. Authoring is file-editing
  against a skeleton, not `new`-from-spec, so there was never a second document to keep in sync.

## Slash-command demotion and dogfooding

After this lands, slash commands are thin wrappers over the CLI; the CLI is what background (headless)
agents and humans both call — the same `approve`/`lint`/`list`/`analyze` verbs either caller invokes.
`toolsmith`'s own CLI is itself a narrow, allowlistable tool: it eats its own dogfood, and the
background forge agents this doc's CLI exists to serve are allowlisted for it the same way any forged
tool is — through the two approvals `product-framing-and-principles.md:29-36` already defines, applied
recursively to the tool that builds tools.

## Out of scope

- **AI auto-approval of raw commands** — considered and rejected; see
  [Steering & gap-adjudication](./steering-adjudication.md)'s first safety invariant.
- **The curator's internal tool-modification mechanics** and **quote-aware command parsing** — the
  latter is a known, separately-tracked gap (`toolsmith-check.mjs`'s parser is documented as not
  quote-aware; #41's non-goals flag it as a follow-up, not something to fix incidentally here).
- **Any implementation.** This doc and `steering-adjudication.md` are canon only; the CLI, the
  adjudicator, the template tier, and the evolution dispatch are future work gated on these docs
  landing. They feed #37 and #42 and are consumed by them — they do not claim to *be* either.
