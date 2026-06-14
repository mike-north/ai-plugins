# Authoring a hook (read fresh)

A hook is a **deterministic reaction to the agent's own session/tool lifecycle events**. The action
should be a command/script — not "ask the model to…". Use a hook only when the reaction must be
**guaranteed** (a rule can be forgotten).

## Before authoring — read the canonical docs LIVE (don't trust memory)

- **Claude Code:** WebFetch `https://code.claude.com/docs/en/hooks.md` — the current event names
  (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart, SessionEnd, …), matcher syntax,
  the input/output JSON contract, and how to block/modify a tool call.
- **Cursor / Gemini:** fetch the host's current hooks doc fresh; event sets differ. **Codex** has no
  hooks concept — for Codex, route the need elsewhere (script + invocation).

## Prefer the delegate

If the `update-config` skill is available, delegate — it owns settings/hooks wiring and avoids
hand-editing mistakes. Otherwise author by hand against the freshly-read docs.

## In this marketplace's plugin format

Hooks are authored in `hooks/claude.yaml` (the build converts to `hooks/claude.json` and Gemini's
`hooks.json`). Keep the command a thin shell that calls a deterministic script where possible.

## Determinism note

The hook *is* the deterministic mechanism. If the reaction needs no judgment at all and isn't tied to
the agent's own action, it may just be a script + OS cron instead.
