import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Arrange a briefed, two-way voice conversation between a human and an AI session, then bring structured findings back into the agent's workstream \u2014 the agent syncs the docs, frames the talk for voice, and seeds a chat to continue on mobile. Powered by aichatctl.",
  keywords: ["voice", "conversation", "aichatctl", "decisions", "feedback"],
});
