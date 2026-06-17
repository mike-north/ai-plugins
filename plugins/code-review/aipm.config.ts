import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Adaptive, host-neutral code review \u2014 detects the stack, routes to specialist reviewer lenses dispatched as agents with their own context windows, and records findings as SARIF.",
  keywords: ["code-review", "review", "sarif", "code-quality", "multi-language"],
});
