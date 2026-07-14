# Authoring a hook (read fresh)

A hook is a **deterministic reaction to the agent's own session/tool lifecycle events**. The action
is *usually* a command/script — not "ask the model to…" — though it may also fire a guaranteed
agentic step. Use a hook only when the reaction must be **guaranteed** (a rule can be forgotten).

## Hooks are broadly supported — not Claude-only

~13+ harnesses ship full hook systems (Claude Code, **Codex**, Gemini CLI, GitHub Copilot, Kiro,
Cursor, Droid, Cortex Code, CodeBuddy, Amp, Cline, Windsurf, …). **Event vocabularies differ**, so
pick the event by intent, then read the host's current docs for the exact name. A rough cross-walk:

| Intent | Claude Code | Codex CLI | Gemini CLI |
|---|---|---|---|
| before a tool runs | `PreToolUse` | `PreToolUse` | `BeforeTool` |
| after a tool runs | `PostToolUse` | `PostToolUse` | `AfterTool` |
| user submitted a prompt | `UserPromptSubmit` | `UserPromptSubmit` | `BeforeAgent` |
| turn / response completes | `Stop` | `Stop` | `AfterAgent` |
| session begins | `SessionStart` | `SessionStart` | `SessionStart` |

Codex shares Claude's event names but exposes the plugin root as **`PLUGIN_ROOT`** (not
`CLAUDE_PLUGIN_ROOT`) and uses **`apply_patch`** as its edit-tool matcher. Codex lacks `SessionEnd`
(use `Stop`). Gemini renames most events (above).

## Before authoring — read the canonical docs LIVE (don't trust memory)

- **Claude Code:** WebFetch `https://code.claude.com/docs/en/hooks.md` — current event names, matcher
  syntax, the input/output JSON contract, and how to block/modify a tool call.
- **Codex CLI:** WebFetch `https://developers.openai.com/codex/hooks` — Codex's events, `hooks.json` /
  inline `config.toml` form, plugin-bundled hooks (`.codex-plugin/plugin.json` `"hooks"`), `PLUGIN_ROOT`.
- **Gemini CLI:** WebFetch `https://geminicli.com/docs/hooks/` — Gemini's event names + `hooks.json` shape.
- **Other hosts (Kiro, Cursor, Droid, …):** fetch that host's hooks doc fresh; event sets differ.

## In this marketplace's plugin format

Author once in `hooks/claude.yaml`. `pnpm run build:hooks` emits one file per host (all sharing the
`{ "hooks": { "<Event>": [...] } }` shape):
- `hooks/claude.json` (verbatim, Claude's vocabulary) — committed; Claude installs from source.
- `hooks/codex.json` (Codex) — same events, but commands rewritten to `${PLUGIN_ROOT}` and `Write`/`Edit`
  matchers → `apply_patch`; events Codex lacks are omitted with a warning. Committed; Codex installs from
  source, with `.codex-plugin/plugin.json` `"hooks": "./hooks/codex.json"`.
- `hooks/hooks.json` (Gemini) — translating **both** tool matchers (`Write` → `write_file`) **and event
  names** (`PreToolUse` → `BeforeTool`, `Stop` → `AfterAgent`, …); events with no Gemini equivalent are
  **omitted with a warning** — never silently remapped. Gitignored; Gemini installs from the `dist/` export.

Keep the command a thin shell that calls a deterministic script where possible.

## When the target genuinely has no hooks

A few hosts still have no hook system. Hooks require runtime event interception, so they are **not
polyfillable for *gating*** — a hook that blocks/validates a tool call cannot be emulated by config; on
such a host, **omit** the gate and warn (the work moves to an MCP tool or a manual step).

But a **periodic / lifecycle** reaction (not a gate) *does* degrade well: express it as **root guidance**
(fully polyfillable) — an `AGENTS.md` / `CLAUDE.md` instruction that runs a deterministic script at
session start (e.g. *"at session start, if `should-x` reports due, run /x"*) plus the script itself.
(Note: Codex is no longer an example here — it has hooks now.)

## Prefer the delegate

If the `update-config` skill is available, delegate — it owns settings/hooks wiring and avoids
hand-editing mistakes. Otherwise author by hand against the freshly-read docs.

## Determinism note

The hook *is* the deterministic mechanism. If the reaction needs no judgment at all and isn't tied to
the agent's own action, it may just be a script + OS cron instead.
