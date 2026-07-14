import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.1.0",
  targets: ["claude", "cursor", "codex"],
  description: "Composable code review: worktree-based review workspaces, signal-routed reviewer lenses, fixes captured as real edits and converted to GitHub suggestions, SARIF interchange, and pending-review posting to github.com or GHE.",
  keywords: ["code-review", "review", "sarif", "code-quality", "multi-language", "suggestions", "worktree"],
});
