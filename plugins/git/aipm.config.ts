import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Deterministic local-git utilities for agents: exact diff statistics (meaningful vs raw line counts, implementation vs test split), a stacked-PR manager (gst), and git-identity \u2014 per-host resolution of commit author + GPG key + arbitrary fields, keyed on the remote. Run the scripts for exact results \u2014 never estimate.",
  keywords: ["git", "diff", "stacked-prs", "branches", "metrics", "worktrees", "identity", "ssh", "gpg", "commit-author"],
});
