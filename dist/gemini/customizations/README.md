# Customizations

A **router** for agent customization — the modernized successor to the old `/create_customization`
flow. You describe how you want your agent to behave ("make this automatic", "always do X", "remember
that…", "watch this and tell me when it changes", "bundle these so I can toggle them per project") and
it routes the need to the **right primitive** at the **right scope**, authoring the light ones directly
and delegating the heavy ones to authoritative tools.

## The doctrine: right-size the resource

An agent is expensive and probabilistic. Every need is matched to the **cheapest mechanism that clears
the reliability bar**, along two axes:

- **Mechanism (determinism-first):** deterministic code (script, hook, monitor) over model reasoning
  whenever it can do the job — and even reasoning primitives are *armed with scripts*.
- **Model tier (cheapest-effective-tier):** push reasoning to the lowest model tier that does the job
  nearly as well; offload menial/high-volume work to cheap, tool-scoped, disposable subagents.

## The primitives

`script · memory · rule · hook · skill · agent · mcp · monitor · plugin · marketplace` — distinguished
by *what they contribute* and *how they trigger*. `hook : the agent's own actions :: monitor : the
world`. `plugin` and `marketplace` are containers (a plugin bundles the rest into a toggleable unit; a
marketplace hosts/distributes/toggles plugins).

## Usage

```
/customizations create            # triage a need to the right primitive
/customizations create <type>     # author a specific primitive directly
/customizations list              # show tracked customizations + marketplace plugins
/customizations remove <slug>     # remove a customization (and its artifacts)
```

The `customizations` skill also auto-activates on natural-language customization intent.

## What's inside

- `skills/customizations/SKILL.md` — the routing brain.
- `commands/customizations.md` — the `/customizations` entry point.
- `skills/customizations/reference/` — `triage.md` (the tells + discriminators), `delegation.md`,
  `provenance.md`, `chaining.md`, `manifest.md`, and per-type read-fresh `authoring/` pointers.
- `skills/customizations/scripts/manifest.mjs` — deterministic bookkeeping for tracked customizations.
- `evals/` — a structured routing eval set + a deterministic scorer that prove the routing works and
  keeps improving.

## Delegates (installed on demand)

Skills → `anthropic-skills:skill-creator`; hooks → `update-config`; agents/MCP →
`plugin-dev:*`; monitors → `setup-monitors` + the `@agentmonitors/cli`; plugins/marketplaces →
`marketplace-authoring` + `aipm`. Missing delegates are proposed and installed only on your
confirmation.

## License

ISC
