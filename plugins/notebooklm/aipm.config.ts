import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Turn repo files and links into a focused NotebookLM audio podcast you can listen to on the go \u2014 the agent picks the format and writes the host-focus prompt; aichatctl creates the notebook and starts generation.",
  keywords: ["podcast", "notebooklm", "audio", "aichatctl", "voice"],
});
