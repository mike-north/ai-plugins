---
name: notebooklm
description: Turn repo files and links into a focused NotebookLM audio podcast you can listen to on the go — the agent picks the format and writes the host-focus prompt; aichatctl creates the notebook and starts generation.
version: 0.0.1
---

# NotebookLM Podcast

This power turns source material — repo files, docs, and links — into a NotebookLM **Audio Overview**: an LLM-generated podcast with two hosts discussing the material that you listen to on mobile. The agent curates the sources, picks the format, sets the length, and crafts a host-focus prompt aimed at exactly what you need; the `aichatctl` CLI creates the notebook, adds the sources, and kicks off generation.

## Capabilities

The `notebooklm` skill drives the whole flow:

- **Format selection**: Chooses among the four NotebookLM Audio Overview formats — `deep-dive`, `brief`, `critique`, or `debate` — to fit your goal.
- **Length control**: Sets `--length short | default | long` as a hint to NotebookLM.
- **Source curation**: Picks the files and links worth narrating, favoring prose over code-heavy material.
- **Host-focus prompting**: Writes an audio-first prompt that steers the two hosts toward the audience, angle, and concepts that matter.
- **Generation kickoff**: Calls `aichatctl` to create the notebook and start rendering, then hands you the notebook URL to open on mobile.

## Related Files

- `skills/notebooklm/` — the `notebooklm` skill (`SKILL.md`) and its `references/` (`aichatctl-cli.md` for the transport model and reason-vs-execute contract; `spoken-medium-principles.md` for writing for the ear).
