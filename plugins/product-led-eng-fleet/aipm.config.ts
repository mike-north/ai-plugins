import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Run a product-led engineering fleet: a PM/orchestrator loop that ships work via self-contained GitHub issues, with implementer sub-agents that pick them up, build against acceptance criteria, and open PRs. The work queue is detected by a deterministic git/gh engine, not by agent reasoning.",
  keywords: ["engineering", "orchestration", "agents", "github-issues", "workflow", "fleet"],
});
