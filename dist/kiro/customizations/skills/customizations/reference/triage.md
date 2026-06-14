# Triage — choosing the right customization primitive

This is the routing heart of the `customizations` skill. The brain (`../SKILL.md`) gives the flow;
this doc gives the **tells**, the **discriminators**, and the **per-type playbooks**. Consult it;
don't improvise the mapping.

## The doctrine that sits above every choice: right-size the resource

Match the work to the **cheapest mechanism that clears the reliability bar**, on two axes:

- **Axis 1 — mechanism (determinism-first):** deterministic code (script, hook, monitor) beats model
  reasoning (rule, skill, agent) whenever it can do the job. Apply as a *gate* (whole need
  deterministic → script) and as a *discipline* (decompose every customization so the maximum runs
  in deterministic mechanisms; arm reasoning primitives with scripts).
- **Axis 2 — model tier (cheapest-effective-tier):** when reasoning is needed, push it to the lowest
  model tier that does the job nearly as well. Active duty — assess this even when unasked, and route
  qualifying work to a cheap, tool-scoped, disposable subagent.

Say the payoff out loud: **tokens saved × reliability gained.**

## High-conviction tells

| Primitive | The tell (high conviction) | Determinism / tier note |
|---|---|---|
| **script / CLI** | Exact input→output; same input → same output; correctness mechanically checkable (count, parse, format, validate, transform, fetch-and-extract). CLI form when invoked repeatedly with varying args. | This *is* the Axis-1 gate. If the whole task is this, stop here. |
| **memory** | A *declarative fact* to recall — identity, a decision made, a project fact. No imperative verb aimed at behavior. | If the fact is cheaply derivable on demand, prefer a script over a stored fact that goes stale. |
| **rule / guidance** | A *standing directive* needing judgment, applied broadly. "Always/never/prefer…", a convention. Soft-nudge tolerance acceptable. | If mechanically enforceable AND must never be skipped → **hook**. |
| **hook** | "Every time the agent does X (edits a file, runs a tool, starts/stops a session) → do Y," Y mechanical and must be reliable. Trigger = the agent's **own** event. | Deterministic by nature; ensure Y is a command/script, not "ask the model to…". |
| **skill** | Reusable expertise needing judgment; **or** a need for per-session/per-subagent **toggling**, **invocation control** (user-only), or **bundling related hooks+resources**. | Arm it with scripts; keep the skill thin judgment over deterministic helpers. Could a cheaper tier run the procedure? |
| **agent** | **Context isolation · parallelism · distinct role/expertise · cheaper-tier offload · tool-scoping** (ban a tool in the orchestrator, allow only in a disposable subagent). | The most expensive option — don't use where a script + one tool call suffices. Pin a cheap tier when the work allows. |
| **mcp** | Calls an external system **many ways with model-driven choice** (breadth), *and* the environment permits MCP. | A *fixed* external call → a script/CLI wrapper (cheaper, portable). Restricted/expensive → decompose (script + skill, or script + monitor). |
| **monitor** | React to the **world**: **poll** (file / URL / command output / incoming git) or **push** (inbound webhook). Change originates outside the agent, possibly with no session active. | Expensive/noisy source → chain a script extractor → `command-poll` monitor. No agent need at all → script + OS cron. |
| **plugin** | A *coherent set* of capabilities that belong together AND that you want to toggle on/off as a unit by context/agent-role. | Bundling + toggleability — not justified by a single artifact. |
| **marketplace** | You want the *plugin* primitive at all (none exists), or to distribute/version/toggle plugins across machines. | The precondition container for plugins. |

## Confusable-pair discriminators (the single splitting question)

- **rule vs hook** — *"Enforceable mechanically AND must never be skipped?"* → hook. Broad/judgment/soft → rule.
- **rule vs memory** — *"Tell the agent to **do** something, or to **know** something?"* Do → rule. Know → memory.
- **script vs skill** — *"Can you write the exact steps as code?"* Yes → script. Needs judgment/adaptation → skill (armed with scripts).
- **skill vs agent** — *"Need a separate context/actor (isolation, parallelism, a role, a cheap tier, a scoped tool), or just know-how in the current flow?"* Separate → agent. Know-how → skill.
- **hook vs monitor** — *"Trigger from the agent's **own** action, or from the **world**?"* Own → hook. World → monitor.
- **mcp vs script** — *"Model-driven breadth of operations, or a fixed call?"* Breadth (and MCP allowed) → mcp. Fixed/restricted → script wrapper.
- **skill vs rule (toggleability)** — *"Need per-session/per-subagent enablement or invocation control?"* → skill (rules can't be conditionally enabled or invocation-scoped).

**Master discriminator (cuts across all):** *"Must it be guaranteed?"* If yes, a model-gated
primitive (rule/skill/memory) is disqualified *for the guarantee* — the model can forget. Use a
hook/script/monitor. (You may still pair a rule for nuance with a hook for the guarantee.)

## Per-type playbooks

Every playbook ends with the same two checks: **(D) push down to deterministic** — what can become a
script? **(T) cheaper tier** — could a cheaper model do the remaining reasoning nearly as well?

### script / CLI
- **When:** the Axis-1 gate fires, or you're building the deterministic engine under another type.
- **Author:** inline Bash/Node, no deps; deterministic, testable. Add `--help` + arg parsing for the CLI form. Place under the relevant skill/plugin's `scripts/` when it arms one.
- Scope: project if repo-specific; global if cross-project.

### memory (facts)
- **When:** a durable fact to recall. See `authoring/memory.md` for target resolution (native memory
  subsystem → `AGENTS.md ## Facts` polyfill) and delegation to memory skills.
- **(D)** If derivable, prefer a script. **(T)** n/a.

### rule / guidance (directives)
- **When:** a standing directive that needs judgment and tolerates being a soft nudge.
- **Author:** inline (CLAUDE.md line / rule file / `.mdc`). See `authoring/rule.md`.
- **Guard:** if it must be guaranteed → hook instead.

### hook
- **When:** guarantee a mechanical reaction to the agent's own session event.
- **Trigger ownership (decisive):** a Claude hook fires ONLY on the *agent's own* tool events
  (PostToolUse on Edit/Write, etc.). "Every time **I** save / commit / open a file" is the *user's*
  action, not an agent event — that's a deterministic **script** wired to format-on-save or a git
  pre-commit hook (delivery mechanism, not a Claude `hook`). A *world* change (an external file, a
  URL) is a **monitor**. Only "every time **you** (the agent) edit/run X" is a Claude hook.
- **Author/delegate:** `update-config` skill; else read `authoring/hook.md` fresh. The action is
  *usually* a deterministic script/command, but it can also fire an **agentic** step (e.g. a
  guaranteed security review of every edit) — the hook's job is to *guarantee the reaction fires*,
  deterministic or not. **(D)** prefer a script when the reaction can be one.

### skill
- **When:** reusable judgment-bearing expertise; or toggling/invocation-control/hook-bundling need.
- **First:** `list` existing customizations — **extend an existing skill** rather than proliferate.
- **Delegate:** `anthropic-skills:skill-creator` (authoritative). Large skills route to
  `resources/*.md` conditionally. **(D)** co-produce the scripts that arm it. **(T)** consider a
  cheaper tier for the procedure.
- **Provenance:** if extending an imported skill, check `provenance.md` first.

### agent
- **When:** isolation / parallelism / role / cheaper-tier offload / tool-scoping.
- **Delegate:** `plugin-dev:agent-development`. Set the model tier and the allowed/forbidden tools
  deliberately. **(D)** push data work into queries/scripts before the agent reasons. **(T)** the
  tier choice *is* Axis 2.

### mcp
- **When:** model-driven breadth against an external system, MCP permitted.
- **Delegate:** `plugin-dev:mcp-integration`. **Decompose** under enterprise restriction or for
  expensive/noisy sources → script (capability) + skill (semantic activation), or script + monitor
  (watching). See `chaining.md`.

### monitor
- **When:** awareness of the world (poll or push). See `authoring/monitor.md`.
- **Delegate:** `setup-monitors` skill + the `agentmonitors` CLI (`init` to scaffold, `validate` to
  verify). **(D)** for expensive/noisy sources, chain an extractor script → `command-poll` monitor.

### plugin / marketplace
- **When:** bundle-to-toggle (plugin) or host/distribute plugins (marketplace).
- **Delegate:** `marketplace-authoring` + `aipm` (`scaffold` / `init`). If no personal marketplace is
  known, route to **marketplace** first. See `delegation.md` + `provenance.md`.

## Before authoring anything

1. **Reuse first.** `list` existing customizations; prefer extending one (especially skills).
2. **Provenance.** If touching an imported artifact, apply `provenance.md` (consumer → personal
   override; contributor → edit + offer PR; unknown → ask).
3. **Scope.** Recommend global vs project (see `../SKILL.md` "Scope"); always confirm.
4. **Read references fresh.** Before authoring a type with canonical docs, WebFetch them live
   (`authoring/<type>.md`) or run the delegate's validator — never a memorized format.
