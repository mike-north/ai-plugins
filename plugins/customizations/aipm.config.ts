import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Route any agent-customization need to the right primitive \u2014 script, memory, rule, hook, skill, agent, MCP, monitor, plugin, or marketplace \u2014 determinism-first, authoring the light ones and delegating the rest. Includes /customizations create|list|remove.",
  keywords: ["customization", "routing", "determinism", "skills", "hooks", "monitors", "plugins", "memory", "agents", "meta"],
});
