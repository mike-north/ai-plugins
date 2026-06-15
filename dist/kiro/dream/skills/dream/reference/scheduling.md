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

### 1. Turn-end hook (`hooks/claude.yaml`) — where hooks exist

On `Stop` (Claude **and Codex** — both fire it when a turn completes; `build:hooks`
translates it to `AfterAgent` for Gemini) — run `should-dream.mjs tick`. This *queues* a
dream by dropping the flag; it never runs the skill itself (a hook runs a command, not an
agentic skill). ~10ms no-op when not due. One `hooks/claude.yaml` source builds the
per-host files: `claude.json`, `codex.json` (PLUGIN_ROOT env), and the Gemini `hooks.json`.

### 2. Session-start rule (`steering/auto-dream.md`) — launches the skill

An always-on rule instructs the agent, at session start, to consult
`should-dream.mjs status` and, if a dream is pending/due, run `/dream`. This is **always**
root guidance, on every host: a hook drops the flag but can't run an agentic skill, so the
launch is never a hook. It's delivered as `steering/auto-dream.md` (Kiro), `GEMINI.md`
(Gemini), and an `AGENTS.md` / `CLAUDE.md` snippet (Codex / Claude).

Together: hook flags it → rule catches it next session.

## Hosts with no hooks at all — the fallback

Claude, Codex, and Gemini all have hooks, so they get the deterministic flag-drop. On a
host with **no** hook system, there is no `tick` — but the trigger still works: the
session-start rule runs `should-dream.mjs status` itself at startup and launches `/dream`
when due. A *gating* hook can't be polyfilled, but this is a *periodic* trigger, which
degrades cleanly to root guidance. See the customizations plugin's `authoring/hook.md` for
the general "gating vs periodic" rule.
