# Agent-type–specific harnesses

> **Status**: adopted into the harness program canon 2026-07-19 (moved from the original brainstorm drafts). Governs fleet work per [README](./README.md).
>
> **Staffing**: owned by the **harnesses PM** (Phase 2 — stands up once the ratification flow exists to materialize against; see [ROADMAP](./ROADMAP.md)).


Mike North · 2026-07-19 · Captured from a design brainstorm. Companion thinking to the Toolsmith docs (architecture steer, product framing, design patterns, runtime spec).

## The idea in one paragraph

Graduate from a single general-purpose orchestrating agent — running against one bloated user-level Claude Code configuration — to a roster of **dedicated harnesses, one per agent type**: product manager, tech lead, code reviewer, public API reviewer, CLI command safety adjudicator, and so on. Each agent type is a fully materialized bundle of configuration (CLAUDE.md, skills, hooks, rules, plugins, sub-agent definitions, deterministic scripts, forged-tool grants, tool-use permissions) plus its own 1Password environment. The same move Toolsmith made for tools — replacing the muddy general thing with narrow, reviewable, grantable units — applied one layer up, to the harness itself.

## Why

Two motivations, and only one of them is security:

1. **Context hygiene / focus.** A feature-implementing agent is biased by its own goal ("everything I changed is surely internal"). A fresh, dedicated specialist reads the situation cold. Canonical example: an api-extractor public API report changes in a PR → spawn a **public API reviewer** agent that is deeply versed in the maintainer's semver philosophy and design patterns, with no stake in the feature that caused the diff. The trigger (report changed) defines the role's existence.
2. **Limited autonomy and adversarial balance.** Separation of duties by construction: the agent that writes code is not the agent that merges it. Roles hold different authority (per Toolsmith's precondition/authority archetypes), so they check each other structurally, not just via prompt-level politeness. Differentiation comes from skills, hooks, rules, CLAUDE.md, goals, and permissions — not from different models.

Additional wins: token efficiency (specialists carry only what their job needs) and the ability to comfortably grant a role access to specific capabilities while forbidding others.

## The keystone: agent type as primary key

**One string — the agent type — is the primary key everything else hangs off:**

- It's what you pass to the **launcher** (a thin wrapper around Claude Code / Codex).
- It names the **configuration root** (a folder on disk that serves as the harness).
- It names the **1Password environment** (the launcher runs `op run --environment <id>`, establishing a subshell where only that role's secrets exist, then boots the harness inside it).
- It's the same string that arrives in every **hook payload** (`agent_type`, alongside `session_id` and `agent_id`), so the identity you launch with is the identity you enforce against. No mapping table, no translation layer that can drift.

Launching is composition: say `product-manager`, and the launcher resolves the config root, resolves the environment, wires the subshell, and boots the harness. The project you run it in is the orthogonal axis — agent type is *who I am*, project is *where I'm working*.

### Convention over configuration

Resolution is by naming discipline, not a registry: the folder is named for the agent type, the 1Password environment is named for the agent type. The launcher is stateless — the name *is* the lookup. It verifies all legs exist before booting and **fails loud and early** (with a did-you-mean against the on-disk roster — the runtime's existing `forge::suggest` helper) rather than falling back to any default.

## Trust domain and control layers

**The trust domain is the session, not the thread.** An orchestrator and every sub-agent it spawns via Task share one session ID (with `agent_id` distinguishing spawns), and sub-agents inherit the parent's environment. That's acceptable by design: sub-agents are a means to the parent's end, and the governed thing is which orchestrator types exist and what each may spawn. The three IDs in the hook payload — session, agent type, agent ID — are three nested scopes; pick the radius per rule.

The control stack, coarse to fine:

| Layer | Granularity | Character |
|---|---|---|
| 1Password environment | Whole session (incl. sub-agents) | The credential/capability floor. Secrets the role doesn't hold literally never enter its subshell. |
| `allowedTools` on sub-agents | Tool-class level | Blunt — "Bash" is one big yes/no. |
| Hooks (keyed on agent type + command content) | Per-invocation, surgical | The real policy engine. Same place Toolsmith already operates, so it composes. |

The blunt layers fail safe; the hook layer does the precision work. (The policy layer itself was deliberately parked as its own future topic.)

## Base configuration vs. user-level configuration

**Strong opinion: there is a base configuration root that every harness inherits, and it is *not* user-level config.**

- **Base** is a deliberate, owned, first-class layer: the genuinely universal stuff (core CLAUDE.md conventions, the Toolsmith plugin, baseline hooks). It's a config root like any other — same review and immutability rules, not an escape hatch.
- **User-level config still exists** — some entry points (Claude desktop, the agent SDK without an explicit root) implicitly need it — but it is **demoted from universal ancestor**. Two disconnected trees: user-level serves the implicit-entry-point world; base serves the deliberate-harness world. A specialist resolves to base + role, full stop; the personal soup never leaks in.
- **Enforcement mechanism:** Claude Code and Codex both accept a flag that overrides what's treated as the user-level config folder. The launcher passes the resolved config root through that flag explicitly, making the disconnection a guarantee rather than an intention. The launcher contract stays harness-agnostic — same agent-type string, same resolved root, different flag name per tool.

## Composition and materialization

Roles share common material, but **sharing-by-reference at runtime is out; composition into a materialized artifact is in.**

- **Source vs. artifact, expressed in Git.** `main` holds the layered, DRY, human-authored layer definitions. A **materialized branch** holds the flattened output, recomputed by CI (e.g. a GitHub Action) on changes to main. The launcher only ever points at the materialized branch.
- **Materialization is a compatibility device, not a trust device.** It exists so every consuming tool sees exactly the one plain thing it expects — a config root that's just a folder, an environment that's just flat values — with no symlink cleverness or 1Password cascade logic that each tool would have to handle. Whatever composition happens upstream, everything downstream receives something **singular and dumb**. No tool needs to know layers ever existed.
- **Review happens on source.** Intent lives in the layers; the flattened output is a mechanical consequence. Trust in the artifact comes from the transform being deterministic and reproducible, not from a second human review of the build output. (The materialization diff / shadow report is still useful as a spotlight — an intended override reads as quiet confirmation, an accidental one catches the eye.)

## Reconciliation semantics: the razor

The central design principle, arrived at after working through several candidate collision models:

> **The materializer introduces zero new semantics — only a new axis (layering) over rules that already exist. It's a transport, not a language. Any time composition needs a decision, the answer is whatever the native tool would do.**

How we got there:

1. **Syntactic collisions don't exist within one schema.** The schema is the arbiter, not the observed value. If a field admits string-or-object, then a string in base and an object in role are both inhabitants of the same field type; shadowing the less specific with the more specific is always well-defined, because the runtime reader already declared it accepts either. A genuine "type collision" requires two different schemas — which is a category error you'd never be reconciling anyway. So materialization never adjudicates validity; it applies precedence and reports what shadowed what.
2. **Semantic collisions resolve by mirroring native cascade rules — per artifact type.** The instructive case: base forbids Bash, product-manager config allows it. Pure closest-wins would make that privilege escalation by shadow. But the native permissions model already evaluates the **deny tree first**; only what survives is evaluated for ask, then allow, then ambiguity falls back to the harness mode. Mirroring that gives the security floor **for free**: base's deny cannot be widened from above, as an emergent property rather than an invented feature.
3. **Each artifact inherits its own tool's native composition model.** Permissions: deny-first cascade. Environment values: closest-wins shadow. Skills: the native project-shadows-user model. Hooks: union/concatenation across layers (with ordering and dedup mirroring however Claude Code natively merges user- and project-level hooks). One file may even mix models by key (settings.json: cascade for permissions, shadow for plain scalars).
4. **Conflict handling: warn loudly, resolve by native precedence.** Failing loudly at materialization would enforce a stricter rule than the runtime honors — training yourself on invariants the tools don't share. The residual risk (an unintended shadow) is exactly what the warn/shadow-report surfaces.
5. **Where the native law isn't known, it's discoverable, not inventable.** As long as something is configurable at both project and user level, the tool already decided what happens when both define it. A two-line experiment (set both, launch, observe) turns every unknown from a design question into an empirical one. The materializer's spec is documented observed behavior.

### Why the razor matters: compatibility in both directions

Two deep justifications:

- **The ecosystem argument.** This should feel like a *missing native feature* of Claude Code/Codex. Skills that build hooks or configure permissions are authored against the native mental model; a private materializer semantics would force a Toolsmith-aware variant of every one of them — forking the config-authoring ecosystem. Mirroring means they all just work, unmodified.
- **The round-trip argument.** Tools write config back at runtime (e.g. "always allow this bash command" lands in the harness's settings.json). If the materializer's semantics are the tool's semantics, that write-back can be reconciled into the layered source mechanically. Any divergence corrupts the layers or demands a reconciliation shim — precisely the cleverness being refused. Backwards *and* forwards compatibility with native behavior is the constraint.

## The complicated artifacts

Three artifacts genuinely stress the model — **settings.json, hooks, and MCP config** — each in a different way (cascade-with-mixed-models, union-with-ordering, and named-identity merge respectively). All three yield to the razor plus experiments.

### ~/.claude.json, the messy one

`claude.json` (distinct from settings.json) conflates several trust classes in one blob: Anthropic-managed fields, user-managed fields, and live counters (token spend, project locations, session bookkeeping) that mutate constantly. Hashing or signing it wholesale is meaningless. It also appears to be consulted regardless of where the config root points.

The resolution is a **three-way sort** of every config field:

1. **Authored role identity** — composes through the layers, gets materialized, hashed, reviewed (settings, hooks, MCP servers, skills).
2. **Agent-definition-owned fields** — e.g. default model. Superseded by the agent type itself: the launcher asserts them explicitly, winning by construction rather than by shadow rules. They don't need cascade semantics at all.
3. **Machine-local exhaust** — counters, project locations, session history. Not materialized, not signed, not the layering system's problem. The tool manages it on its own.

The filter question per field: *is this authored role identity, or machine-local state?*

**The unresolved wrinkle:** MCP server configuration lives inside claude.json. That forces **field-level, piecemeal treatment in both directions** — read only the owned subsection (project a view over just those fields; hash the projection; stay blind to the counters around it), and merge back surgically, touching only owned fields, since the tool rewrites the file wholesale at runtime and a naive materialization would either get clobbered or stomp live state. This is the one place that breaks the clean render-a-file model: it's a surgical merge into a living file, not a branch checkout.

**Open question:** special-case that merge step, or push MCP config out of claude.json entirely if the tools allow it.

## Where this connects to Toolsmith

- Agent types were already the scoping unit for tool grants; harness-per-type makes the toolbox literally a **role-to-authority map** — organizational design as configuration.
- The archetypes carry over: a code author is precondition-gated; a reviewer or sign-off role holds authority the author lacks. Adversarial balance by construction.
- The hook layer is the shared precision instrument — the same PreToolUse machinery that verifies forged-tool grants keys off the same `agent_type`/`session_id` fields to enforce role policy.
- The same design values recur at the harness layer: narrowness as the feature, convention/anti-drift (one token, same meaning everywhere), fail-closed-to-asking, sign-what-executes, review honest and small.

## Open questions and parked topics

- **The policy layer** at the hook level — deliberately parked; it's a deep session of its own.
- **MCP-in-claude.json**: surgical merge vs. relocating MCP config.
- **Hook merge details**: exact native ordering/dedup behavior when multiple layers register hooks on one event — an experiment, per the methodology.
- **Roster and rollout**: build one specialist end-to-end (the public API reviewer is the natural vertical slice) vs. mapping the full roster first — raised but not settled.
- **Array merge semantics** (replace vs. union for lists like `permissions.allow`) — currently answered by "whatever native does," verified by experiment; the shadow report flags whole-array replacement so accidental entry loss is visible.
