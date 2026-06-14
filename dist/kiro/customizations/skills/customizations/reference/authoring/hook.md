# Authoring a hook (read fresh)

A hook is a **deterministic reaction to the agent's own session/tool lifecycle events**. The action
is *usually* a command/script — not "ask the model to…" — though it may also fire a guaranteed
agentic step. Use a hook only when the reaction must be **guaranteed** (a rule can be forgotten).

## Hooks are broadly supported — not Claude-only

~13 harnesses ship full hook systems (Claude Code, Gemini CLI, GitHub Copilot, Kiro, Cursor, Droid,
Cortex Code, CodeBuddy, Amp, Cline, Windsurf, …). **Event vocabularies differ**, so pick the event by
intent, then read the host's current docs for the exact name. A rough cross-walk:

| Intent | Claude Code | Gemini CLI |
|---|---|---|
| before a tool runs | `PreToolUse` | `BeforeTool` |
| after a tool runs | `PostToolUse` | `AfterTool` |
| user submitted a prompt | `UserPromptSubmit` | `BeforeAgent` |
| agent finished responding | `Stop` | `AfterAgent` |
| session begins / ends | `SessionStart` / `SessionEnd` | `SessionStart` / `SessionEnd` |

**Portability tip:** for a periodic/lifecycle reaction (e.g. "consolidate at end of session"), prefer a
**shared** event like `SessionEnd` — native on both Claude and Gemini, so it survives translation
unchanged.

## Before authoring — read the canonical docs LIVE (don't trust memory)

- **Claude Code:** WebFetch `https://code.claude.com/docs/en/hooks.md` — current event names, matcher
  syntax, the input/output JSON contract, and how to block/modify a tool call.
- **Gemini CLI:** WebFetch `https://geminicli.com/docs/hooks/` — Gemini's event names + `hooks.json` shape.
- **Other hosts (Kiro, Cursor, Droid, …):** fetch that host's hooks doc fresh; event sets differ.

## In this marketplace's plugin format

Author once in `hooks/claude.yaml`. `pnpm run build:hooks` emits:
- `hooks/claude.json` (verbatim, Claude's vocabulary), and
- `hooks/hooks.json` (Gemini) — translating **both** tool matchers (`Write` → `write_file`) **and event
  names** (`PreToolUse` → `BeforeTool`, `Stop` → `AfterAgent`, …). Events with no Gemini equivalent are
  **omitted from the Gemini file with a warning** — never silently remapped to a different lifecycle
  point. Keep the command a thin shell that calls a deterministic script where possible.

## When the target has no hooks (e.g. Codex)

Hooks require runtime event interception, so they are **not polyfillable for *gating*** — a hook that
blocks/validates a tool call cannot be emulated by config. On a hook-less host, **omit** the gate and
warn (the work moves to an MCP tool or a manual step).

But a **periodic / lifecycle** reaction (not a gate) *does* degrade well: express it as **root guidance**
(fully polyfillable) — an `AGENTS.md` instruction that runs a deterministic script at session start
(e.g. *"at session start, if `should-x` reports due, run /x"*) plus the script itself. This is the
pattern Codex uses for an auto-trigger it cannot hook.

## Prefer the delegate

If the `update-config` skill is available, delegate — it owns settings/hooks wiring and avoids
hand-editing mistakes. Otherwise author by hand against the freshly-read docs.

## Determinism note

The hook *is* the deterministic mechanism. If the reaction needs no judgment at all and isn't tied to
the agent's own action, it may just be a script + OS cron instead.
