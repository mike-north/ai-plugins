import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Opinionated, allowlistable command-line tools for an agent to engage with GitHub: read-only PR/issue-queue inspection plus bounded write verbs (label, comment, reply/resolve review threads, create issue/PR, mark ready, guarded merge). Each wraps one gh operation with no arbitrary-API escape hatch, so it can be pre-approved while raw `gh api` stays gated.",
  keywords: ["github", "gh", "pull-requests", "issues", "code-review", "automation", "agents"],
});
