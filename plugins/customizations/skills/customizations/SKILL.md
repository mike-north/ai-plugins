---
name: customizations
description: >-
  Use when the user wants to change how their agent works — "make this automatic",
  "always/never do X", "remember that …", "every time I edit … run …", "watch this
  file/URL/command and tell me when it changes", "add a tool for …", or "bundle these
  so I can turn them on/off per project". Routes the need to the right customization
  primitive (script, memory, rule, hook, skill, agent, mcp, monitor, plugin, marketplace)
  determinism-first, authors the light ones directly, and delegates the heavy ones to
  authoritative tools (installing them on demand). Also handles /customizations create|list|remove.
---

# Customizations

A **router** for agent customization. You take a vague wish — "make my agent reliably
do / stop / remember / sense / react to X" — and turn it into the *right* primitive at
the *right* scope, then either author it directly or delegate to the authoritative tool.

You are NOT a re-implementation of the underlying authoring tools. Your value is the
**decision layer** and the **determinism discipline**. When a heavier tool owns a job,
hand off to it.

## The doctrine that governs everything: right-size the resource

An agent is expensive and probabilistic. Match every job to the **cheapest mechanism that clears
the reliability bar**, along two axes:

**Axis 1 — mechanism (determinism-first).**
1. *As a gate.* Before any reasoning primitive, ask: *can this be done with deterministic code?*
   If the whole need is deterministic → it's a **script/CLI**, full stop.
2. *As a discipline inside every customization.* Even when reasoning IS required, decompose so the
   *maximum* load runs in deterministic mechanisms; reserve model reasoning for the **irreducible
   judgment core**; **arm the reasoning primitive with cheap deterministic tools**. Authoring a
   skill/agent routinely *co-produces scripts* — they travel together as one customization.

**Axis 2 — model tier (cheapest-effective-tier).** When reasoning is needed, push it to the lowest
model tier that does the job nearly as well. This is an **active duty**: even when the user doesn't
ask, assess whether the work could run on a cheaper model — if so, route it to a cheap (often
tool-scoped, disposable) **subagent**, keeping premium tiers for work that needs them.

> Terse: **don't use reasoning where code suffices; don't burn a premium model where a cheap one is
> nearly as good.** Say the payoff out loud: *tokens saved × reliability gained.*

## The primitives (what they contribute · how they trigger)

Not a ladder — they differ by *kind*. Two are containers.

- **script / CLI** — deterministic logic. *The preferred default*, and the engine under other types.
- **memory** — a durable *fact* to recall. **rule/guidance** — a standing *directive*.
- **skill** — a **packaged unit of expertise**: judgment-bearing know-how (armed with scripts), which
  may bundle its own hooks + `resources/`, can be **toggled per session / scoped to subagents**
  (rules can't), and can be **user- vs agent-invocable** (user-only = a shortcut you don't want the
  agent doing autonomously, e.g. "merge a PR"). Prefer **extending an existing skill**; large skills
  route to `resources/*.md` conditionally (nested activation).
- **agent** — a sub-task actor with its own context. Tells: **isolation · parallelism · distinct
  role · cheaper-tier offload (Axis 2) · tool-scoping** (ban a tool in the orchestrator, allow it
  only in a disposable subagent).
- **hook** — a deterministic reaction to the agent's **own** session events (efferent).
- **monitor** — deterministic awareness of the **external world** (afferent): **poll** (file / URL /
  command output / incoming git) or **push** (inbound webhook, e.g. Hookdeck).
- **mcp** — native external integration; under restriction it **decomposes** → script + skill (or, for watching, script + monitor).
- **plugin** — a toggleable bundle of the above. **marketplace** — hosts/distributes/toggles plugins.

`hook : the agent's own actions :: monitor : the world` — the same move (deterministic
detection + a precise page) on the two sides of the agent's boundary. **Toggleability is a routing
axis:** need per-session/per-subagent enablement? → skill/plugin, not rule/memory.

## Routing flow

Work through these in order. The full decision table + per-type playbooks are in
`reference/triage.md` — consult it; don't improvise the mapping.

1. **Determinism gate.** Is the whole need just logic (count, parse, transform, fetch-and-extract,
   enforce a rule mechanically)? → **script**. Stop here.

2. **Sense / react? Split detection from response.** If the need is "when X happens, do Y":
   *detection is mechanical — never make the agent the detector* (no agent loop re-pulling and
   diffing in context; no rule that merely *nags* the model to remember). Route detection to a
   deterministic mechanism and wake the agent only on a confirmed signal:
   - react to the **agent's own action** (it edited a file, ran a tool) → **hook**
   - watch the **world** (a file, URL content, a periodic CLI whose output-change matters) → **monitor**
   - raw source **expensive or noisy** → put a deterministic **extractor script** between the
     source and the monitor/hook. See `reference/chaining.md` (the canonical expensive-MCP → script
     → `command-poll` monitor recipe).

3. **Otherwise pick by kind** (see `reference/triage.md` for the full tells + confusable-pair
   discriminators; the master discriminator is *"must it be guaranteed?"* → never rule/skill/memory):
   - durable *fact* → **memory** · standing *directive* → **rule** (do-something vs know-something)
   - reusable expertise, or anything needing per-session/subagent **toggling** or invocation control
     → **skill** (then ask: what scripts should arm it?)
   - needs isolation / parallelism / a role / a cheaper tier / tool-scoping → **agent**
   - external *tool/data* integration → **mcp** (prefer the decomposition under restriction)
   - a coherent bundle to *toggle by context* → **plugin** · a place to host/toggle plugins → **marketplace**

4. **Cheapest-effective-tier (Axis 2).** Whatever reasoning remains: could a cheaper model do it
   nearly as well? If yes, plan to run it in a cheap, tool-scoped subagent.

5. **Reuse & provenance check.** Before creating anything, `list` existing customizations and prefer
   **extending** one (especially skills). If the work would touch an **imported** skill/plugin, check
   its `origin` policy (`reference/provenance.md`): a `consumer`-source artifact must not be edited in
   place — create a **personal override**; a `contributor`-source artifact may be edited (offer a PR);
   unknown → ask.

6. **Choose scope** (global vs project) — see "Scope" below. Always confirm with the user.

7. **Author or delegate.** Author the light primitives yourself (script, memory, rule). For the
   rest, **delegate to the authoritative tool**, installing it on demand if absent (see
   "Install-on-demand"). Before authoring any type that has canonical docs, **read the references
   fresh** (`reference/authoring/<type>.md`) — never rely on memorized formats.

8. **Record it.** Write a manifest entry via the helper script (see "Manifest"). One logical
   customization = one entry, even when it spans a skill + its scripts; set `origin` when imported.

## Delegation (who authors what)

Summary; full commands + fallbacks in `reference/delegation.md`.

| Type | Delegate to |
|---|---|
| script, memory, rule | author inline |
| hook | `update-config` skill; else read `reference/authoring/hook.md` fresh |
| skill | `skill-creator` (authoritative: github.com/anthropics/skills/skills/skill-creator) |
| agent | `plugin-dev:agent-development` |
| mcp | `plugin-dev:mcp-integration` (or decompose → script + skill) |
| monitor | `setup-monitors` skill + the `agentmonitors` CLI (`init` to scaffold, `validate` to verify) |
| plugin / marketplace | `marketplace-authoring` skill + `aipm` (`scaffold` / `init`) |

## Install-on-demand (propose-then-install-on-yes)

When a delegate is missing: **state exactly what will be installed and how, then install only on
the user's confirmation.** Never auto-install silently.

- **Executables run immediately via `npx`/`npm`** and never block: `aipm`
  (`npx -y @ai-plugin-marketplace/cli`), `agentmonitors` (`npm i -g @agentmonitors/cli` or
  `npx -y @agentmonitors/cli`). Use them right away.
- Only the optional **guidance skills/plugins** are install-on-demand and may take effect next
  session — proceed using the executable + read-fresh references in the meantime.
- Host-native install first (`/plugin marketplace add …`), universal fallback `npx plugins add …`
  / `npx skills add …`. Exact commands per delegate: `reference/delegation.md`.

## Monitors (the world-watching primitive)

Delegate authoring to `setup-monitors`. Recognize the signal: *watch a file / URL / a periodic
command's output and react to change.* The artifact is a folder-scoped `MONITOR.md`
(`watch:` + `urgency` required; optional `notify`). Don't reason about the format — scaffold with
`agentmonitors init --type <source>` and verify with `agentmonitors validate`. Sources:
`file-fingerprint`, `api-poll`, `schedule`, `incoming-changes`, and **`command-poll`** (runs a
script and diffs its stdout — the chaining source). Constraints: Claude-only today; if `setup-monitors`
isn't installed, scaffold via the CLI and read the spec fresh. Details: `reference/authoring/monitor.md`.

## Memory (facts) vs rule (directives)

Declarative *fact* the agent should recall → **memory**; imperative *directive* shaping behavior →
**rule**. Memory target resolution, in order: (1) the assistant's **native memory subsystem**
(Claude auto-memory dir `…/memory/MEMORY.md` + `memory/*.md`; Codex `memories`); (2) an
**`AGENTS.md ## Facts`** section as a portable **polyfill** for harnesses with no native memory.
Delegate the write/consolidation to a memory skill (`productivity:memory-management`,
`anthropic-skills:consolidate-memory`) when present. See `reference/authoring/memory.md`.

## Scope (global vs project)

Recommend from two inputs, then **confirm**:
- **Install context** — detect via `${CLAUDE_PLUGIN_ROOT}`: under `~/.claude` → lean global; under a
  project `.claude/` → lean project.
- **Nature** — personal / cross-project → global (`~/.claude/…`); repo-specific → project
  (`<repo>/.claude/…`). Monitors and project-specific scripts/hooks are naturally project-scoped.

## Command surface

`/customizations [subcommand] [type]`:
- `create` (or bare) → run the routing flow above.
- `create <type>` where `type ∈ {script, memory, rule, hook, skill, agent, mcp, monitor, plugin,
  marketplace}` → skip triage and author that type (still recommend scope; still apply the
  determinism discipline; for `plugin` with no known marketplace, route to `marketplace` first).
- `list` → run `scripts/manifest.mjs list` and present tracked customizations (including
  `proposed`) plus plugins in the known personal marketplace.
- `remove <slug>` → `scripts/manifest.mjs remove <slug>` to drop the entry (it prints the
  components), then delete those artifacts (for a `plugin`, unregister via `aipm`). Confirm before deleting.

## Manifest & the Dream seam

Tracked customizations live as one JSON per customization under `~/.claude/customizations/`
(user scope) or `<repo>/.claude/customizations/` (project scope), managed *deterministically* by
`scripts/manifest.mjs` (add/list/get/remove/config). Schema + the personal-marketplace `config.json`
are documented in `reference/manifest.md`.

Entries carry `status: proposed | active`. This is the seam for a future **Dream** plugin: Dream
appends `proposed` customizations discovered from session transcripts; the user reviews them with
`/customizations list` and approves → you author them → flip to `active`. This mirrors the
self-improvement rule: **propose → user approval → never self-modify without consent.** Do not
author `proposed` entries without explicit approval.

## Reference docs

- `reference/triage.md` — the routing heart: per-primitive tells, confusable-pair discriminators,
  the toggleability axis, and per-type playbooks (each with "push down to deterministic" + tier steps).
- `reference/chaining.md` — script+monitor and script+hook recipes (the expensive-MCP example).
- `reference/delegation.md` — per-type delegate, install commands, fallbacks.
- `reference/provenance.md` — the `marketplaces` policy (consumer vs contributor) and override-vs-edit-vs-PR.
- `reference/authoring/<type>.md` — read-fresh pointer docs for the self-authored types.
- `reference/manifest.md` — manifest + `config.json` schema; `status`/`origin`; the `proposed`→`active` lifecycle.
