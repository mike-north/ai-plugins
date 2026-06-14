# Authoring an MCP integration (read fresh) — and when to decompose

MCP gives the agent an **external capability** plus **semantic activation** (the tools are advertised
and the model chooses among them with structured schemas). Choose it only when the agent needs
**model-driven breadth** across many operations *and* the environment permits MCP.

## Before authoring — read the canonical docs LIVE

- **Claude Code:** WebFetch `https://code.claude.com/docs/en/mcp.md` for current server config
  (`.mcp.json`), transports (stdio/SSE/HTTP), and scoping. Fetch the host's MCP doc fresh for
  Cursor/Gemini/Codex — config shapes differ.
- Prefer the **`plugin-dev:mcp-integration`** skill if available; it owns the wiring.

## Decompose under restriction or cost (the common case)

MCP is *one* implementation of "external capability + discovery." When MCP is **forbidden**
(enterprise) or the source is **expensive/noisy**, decompose into cheaper, portable parts:

- **capability → a script/CLI** the agent shells out to (extract just the slice you need), and
- **activation → a skill** whose description fires on the intent and says "to do X, run this CLI", **or**
- **activation → a monitor** when the need is *watching* (poll/push). See `../chaining.md`.

This is the determinism principle applied to integration: a fixed external call should be a script, not
a model-driven tool surface.
