# NotebookLM Podcast

Turn repo files, docs, and links into a NotebookLM **Audio Overview** — an LLM-generated podcast with two hosts discussing the material — that you listen to on mobile. The agent curates the sources, picks the format (deep-dive, brief, critique, or debate), sets the length, and writes a host-focus prompt aimed at exactly what you need; the `aichatctl` CLI creates the notebook and kicks off generation.

## Requirements

- **aichatctl** — the [`aichatctl`](https://github.com/mike-north/aichatctl) CLI, run via `npx aichatctl`.
- **macOS** — NotebookLM is supported only via the AppleScript transport.
- **Signed-in Chrome with the Apple Events toggle** — a Chrome that is signed in to Google with the **"Allow JavaScript from Apple Events"** toggle enabled.

## Usage

The `notebooklm` skill auto-activates when you ask for a podcast or audio overview — for example "make me a podcast about this," "turn this into an audio overview," or "I want to listen to this." The agent then chooses the sources, format, length, and host-focus prompt, and calls `aichatctl` to start generation.

See `skills/notebooklm/SKILL.md` for the full workflow.

## Status

`aichatctl` currently has no way to check whether the podcast has finished rendering — `notebook create` returns at kickoff, and there is no status or poll command. So the skill hands you the notebook URL and tells you to open it in a few minutes rather than claiming the audio is ready. This gap is filed as a feature request upstream ([aichatctl#4](https://github.com/mike-north/aichatctl/issues/4)); when a readiness check lands, the skill will poll it and tell you when the audio is actually ready.

## License

ISC
