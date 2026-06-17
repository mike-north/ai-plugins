import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Let the agent say short lines aloud through the speakers \u2014 status, a nudge for attention, or a one-line spoken summary. Uses macOS `say` today, with a clean path to vocli for real cross-platform TTS.",
  keywords: ["voice", "tts", "speech", "say", "vocli"],
});
