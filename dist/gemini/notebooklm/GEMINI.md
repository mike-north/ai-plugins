# NotebookLM Podcast

This plugin turns repo files, docs, and links into a NotebookLM **Audio Overview** — an LLM-generated podcast with two hosts discussing the material — that you can listen to on a walk or commute. The agent decides which sources to use, picks the format (deep-dive, brief, critique, or debate), sets the length, and writes a host-focus prompt so the podcast concentrates on the aspects that matter most. The `aichatctl` CLI handles the rest: it creates the notebook, adds the sources, and starts generation.

It activates when you ask to turn something into a podcast or audio overview — for example "make me a podcast about this design doc," "turn this into an audio overview," or "I want to listen to this on my commute." The agent returns a notebook URL you open on mobile once the audio has rendered.
