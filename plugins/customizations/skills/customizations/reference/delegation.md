# Delegation & install-on-demand

The `customizations` skill is a router, not a re-implementation. For every type that has an
authoritative authoring tool, **hand off** — and if the tool is missing, **propose-then-install**.

## Who authors what

| Type | Primary delegate | If absent |
|---|---|---|
| script, memory, rule | author inline | — |
| hook | `update-config` skill | read `authoring/hook.md` fresh and author by hand |
| skill | `anthropic-skills:skill-creator` | read `authoring/skill` source fresh (skill-creator on GitHub) |
| agent | `plugin-dev:agent-development` | read `authoring/agent.md` fresh |
| mcp | `plugin-dev:mcp-integration` | decompose → script + skill |
| monitor | `setup-monitors` skill + `agentmonitors` CLI | scaffold via `agentmonitors init`; read the spec fresh |
| plugin / marketplace | `marketplace-authoring` skill + `aipm` | drive `aipm` directly via `npx` |

## The executable-vs-guidance distinction (important)

Two different things may be "missing":

- **Executables** run immediately via `npx`/`npm` and **never block** the flow:
  - `aipm` → `npx -y @ai-plugin-marketplace/cli <cmd>`
  - `agentmonitors` → `npx -y @agentmonitors/cli <cmd>` (or `npm i -g @agentmonitors/cli`)
  Use them right away — you do not need the guidance skill installed to *do* the work.
- **Guidance skills/plugins** (the `marketplace-authoring`, `setup-monitors`, `skill-creator`
  bodies of expertise) are what `install-on-demand` is really about. Installing them may only take
  effect **next session**, so in the meantime proceed with the executable + read-fresh references.

## Install-on-demand protocol: propose-then-install-on-yes

1. **Detect** the missing delegate (is the skill in your available skills? is the CLI on `PATH` /
   runnable via `npx`?).
2. **Propose** — state exactly what will be installed and the exact command. Never auto-install
   silently.
3. **Install only on the user's confirmation.** Prefer the **host-native** command; fall back to the
   universal installers.

| Delegate | Host-native (Claude Code) | Universal fallback |
|---|---|---|
| marketplace-authoring | `/plugin marketplace add ai-plugin-marketplace/tools` | `npx plugins add ai-plugin-marketplace/tools` |
| agentmonitors (plugin) | install the `agentmonitors` plugin from its marketplace | — (and `npm i -g @agentmonitors/cli` for the runtime) |
| skill-creator | usually already present (`anthropic-skills`) | `npx skills add anthropics/skills` |

## Notes

- `skill-creator` is the **authoritative** source for "what makes a good skill"
  (`https://github.com/anthropics/skills/tree/main/skills/skill-creator`) — defer to it, including
  its eval/optimization guidance, rather than encoding skill-authoring rules here.
- For monitors, don't reason about the `MONITOR.md` format — scaffold with `agentmonitors init
  --type <source>` and verify with `agentmonitors validate` (deterministic tools arming the agent).
- Respect `provenance.md` before editing anything a delegate imported from a marketplace.
