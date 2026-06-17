import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Dotfiles management \u2014 chezmoi, fish shell, and environment configuration",
  keywords: ["chezmoi", "dotfiles", "fish", "devtools"],
});
