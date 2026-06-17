---
name: voice
description: Let the agent say short lines aloud through the speakers — status, a nudge for attention, or a one-line spoken summary. Uses macOS `say` today, with a clean path to vocli for real cross-platform TTS.
version: 0.0.1
---

# Voice

This power lets the agent deliberately say a short line aloud to the user through the computer's speakers — a spoken status, a nudge for attention when the user may be away from the screen, or a one-line spoken summary. It is for intentional, specific utterances worth hearing, not a verbatim reading of the chat transcript.

## Capabilities

- **voice (skill)**: Speak a short, self-contained line aloud through `scripts/speak.sh`. Today the wrapper drives the macOS `say` command; it is built to swap to vocli for cross-platform TTS later (`SPEAK_ENGINE=vocli`) with no change to how it's called. For the `say` engine, `SPEAK_VOICE` and `SPEAK_RATE` tune the voice and pace. The skill auto-activates when the agent should speak rather than print, and keeps lines short, self-contained, and free of code, URLs, paths, or IDs read aloud.

## Related Files

- `skills/voice/` — the `voice` skill (`SKILL.md`) plus `references/` (writing and speaking for the ear).
- `scripts/speak.sh` — the engine wrapper that speaks text via macOS `say` today, with a `SPEAK_ENGINE=vocli` path for cross-platform TTS later.
