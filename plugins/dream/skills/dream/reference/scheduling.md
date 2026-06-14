# Scheduling — how a dream gets triggered

Dreaming is split into a **deterministic scheduler** (a script) and an **agentic
runner** (this skill). The scheduler decides *whether* it's time; the skill does the
work. The agent never computes elapsed time.

## State (owned by `scripts/should-dream.mjs`)

In the state dir (`$DREAM_HOME`, default `~/.claude`):
- `.dream-last` — ISO timestamp of the last completed dream.
- `.dream-pending` — presence = a dream is queued/due.

Interval: `$DREAM_INTERVAL_HOURS` (default 24).

CLI:
| Command | Used by | Effect |
|---|---|---|
| `tick` | session-end hook | if due, drop `.dream-pending`; always exit 0 |
| `status [--json]` | session-start trigger | print `{due,pending,lastDream,intervalHours}` |
| `record` | this skill, on finish | stamp `.dream-last=now`, clear `.dream-pending` |
| `clear` | manual | remove `.dream-pending` without recording |

## Two trigger surfaces

### 1. Session-end hook (`hooks/claude.yaml`) — where hooks exist

On `Stop` (Claude) — translated to `AfterAgent` on Gemini by `build:hooks` — run
`should-dream.mjs tick`. This *queues* a dream by dropping the flag; it never runs
the skill itself (a hook runs a command, not an agentic skill). ~10ms no-op when not
due.

### 2. Session-start rule (`steering/auto-dream.md`) — the portable trigger

An always-on rule instructs the agent, at session start, to consult
`should-dream.mjs status` and, if a dream is pending/due, run `/dream`. This is the
**portable** mechanism: it works on every host with root guidance/rules — including
those with no hook system at all.

The hook is an optimization (proactively queues at end of activity); the rule is what
actually launches the skill. Together: hook flags it → rule catches it next session.

## Hook-less hosts (e.g. Codex) — the polyfill

Hooks require runtime event interception and can't be polyfilled for *gating*. But a
*periodic* trigger is not a gate — it degrades to **root guidance**, which is fully
polyfillable. On a host with no hooks (Codex), there is no `tick`; instead the
session-start rule (delivered via `AGENTS.md`) runs `should-dream.mjs status` itself
at startup and launches `/dream` when due. Same script, same `/dream` skill — only the
trigger delivery changes. See the customizations plugin's `authoring/hook.md` for the
general "gating vs periodic" polyfill rule.
