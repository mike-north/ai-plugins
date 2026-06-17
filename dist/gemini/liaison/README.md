# Liaison

An agent skill that acts as a **liaison**: when a coding agent is blocked on a design decision or a significant ambiguity, or needs feedback or discovery from a human (user, customer, stakeholder, or contributor), it arranges a live two-way **voice** conversation with a briefed AI session and brings the results back into its own workstream.

## The dispatch-and-return loop

1. **Brief** — sync the docs the conversation depends on into the target Claude or ChatGPT project, so the human talks to an already-briefed session.
2. **Frame** — shape the topic for voice: one issue, a small option space, a recommendation to react to.
3. **Seed** — seed a chat and hand the human a URL; they open the platform's mobile app and continue **by voice**.
4. **Return** — the human's session produces a structured findings markdown; the agent reads it, records the decisions, and resumes work from where it was blocked.

Powered by the [`aichatctl`](https://github.com/mike-north/aichatctl) CLI.

## Requirements

- **aichatctl** — run via `npx aichatctl`; no separate install needed.
- **macOS + signed-in Chrome** — the AppleScript transport drives a signed-in Chrome session, which must have the **"Allow JavaScript from Apple Events"** toggle enabled.
- **Gemini is seed-only** — it has no project file library, so the docs-sync step is skipped and the brief lives entirely in the seed prompt.

## Usage

The skill auto-activates when the agent should talk something through with a human — a blocking decision, a genuine ambiguity, or gathering feedback/discovery. There is nothing to invoke by hand; the agent recognizes the situation and runs the loop above. For the full workflow, see [`skills/liaison/SKILL.md`](skills/liaison/SKILL.md).

## Status

The loop is not yet fully closed automatically: `aichatctl` is seed/sync only and **cannot read a conversation back**, so the agent arranges the return channel itself (paste-back into the session, a shared file, Notion, Drive, or another synced path). A feature request for automated artifact pull-back is filed upstream ([aichatctl#5](https://github.com/mike-north/aichatctl/issues/5)).

## License

ISC
