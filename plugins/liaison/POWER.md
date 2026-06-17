---
name: liaison
version: 0.0.1
description: Arrange a briefed, two-way voice conversation between a human and an AI session, then bring structured findings back into the agent's workstream — the agent syncs the docs, frames the talk for voice, and seeds a chat to continue on mobile. Powered by aichatctl.
---

# Liaison

This power lets a coding agent step out of the editor and talk something through with a human. When the agent is blocked on a design decision or a genuine ambiguity, or needs feedback or discovery from a user, customer, stakeholder, or contributor, it arranges a live two-way voice conversation with an already-briefed AI session, then relays a structured findings markdown back so it can resume work where it left off.

## Capabilities

- **liaison** (skill): Acts as a liaison between the agent's workstream and a human. It syncs the relevant docs into a Claude or ChatGPT project so the remote session is briefed, frames the conversation for spoken (not written) interaction, seeds a chat the human continues by voice on the platform's mobile app, and defines the structured findings markdown that must come back. Powered by the `aichatctl` CLI (run via `npx aichatctl`) over its AppleScript transport. Note: Gemini is seed-only — it has no project file library, so the brief lives entirely in the seed prompt.

## Related Files

- `skills/liaison/` — the liaison skill (`SKILL.md`) and its supporting files:
  - `references/conversation-modes.md` — choosing the mode; what to brief; what comes back
  - `references/return-contract.md` — the base shape of the findings that come back
  - `references/spoken-medium-principles.md` — writing and speaking for the ear
  - `references/aichatctl-cli.md` — transports, the `doctor` preflight, the reason-vs-execute contract
  - `resources/preambles/<mode>.md` — per-mode conduct for the liaison, attached to the seed
  - `resources/platform/gemini.md` — voice-style overlay prepended on Gemini (answer-focused by default)
