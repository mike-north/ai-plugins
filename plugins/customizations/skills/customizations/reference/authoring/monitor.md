# Authoring a monitor (delegate + verify, don't reason about the format)

A monitor is **deterministic awareness of the external world** — poll (file / URL / command output /
incoming git) or push (inbound webhook). It detects change outside the agent and delivers a timed,
actionable signal into a session. `monitor : the world :: hook : the agent's own actions`.

## Delegate authoring; arm yourself with deterministic tools

Authoring is owned by the **`setup-monitors`** skill (shipped by the `agentmonitors` plugin). Do **not**
hand-reason the `MONITOR.md` format — use the deterministic tools:

- `agentmonitors init --type <source>` to scaffold (`file-fingerprint`, `api-poll`, `schedule`,
  `incoming-changes`, `command-poll`).
- `agentmonitors validate` to verify before considering it done.

The runtime is the **`@agentmonitors/cli`** executable — runs immediately via `npx -y
@agentmonitors/cli …` or `npm i -g @agentmonitors/cli`; you don't need the `setup-monitors` skill
installed to *scaffold/validate*, only for its richer guidance (install-on-demand).

## Read the spec fresh if you must author by hand

If `setup-monitors` isn't installed, scaffold via the CLI and read the spec fresh:
`/Users/mnorth/Development/agentmonitors/docs/specs/001-monitor-definition.md` (the authoritative
`MONITOR.md` definition: `watch:` + `urgency` required; optional `notify`).

## Chaining (the high-leverage move)

For an expensive/noisy source, put a **deterministic extractor script** in front and watch it with a
**`command-poll`** monitor that diffs just the slice. See `../chaining.md`.

## Constraints to degrade around

Claude-only today (`targets: ['claude']`); Claude channels and third-party source install are not GA
(the hook-state transport is the safe default); no native push/webhook source yet — route webhook
needs to `monitor` and note the gap.
