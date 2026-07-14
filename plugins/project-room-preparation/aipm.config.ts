import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Organize messy project sources into an inspectable \"project room\" before drafting begins \u2014 source inventory, duplicate log, conflict log, missing-context list, and working brief.",
  keywords: ["skills", "writing", "research", "knowledge-management"],
});
