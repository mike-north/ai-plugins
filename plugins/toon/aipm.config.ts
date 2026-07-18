import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: '0.2.1',
  targets: ['claude', 'codex', 'cursor'],
  description:
    'Deterministic hook pair that routes JSON-emitting shell commands (Bash on Claude Code/Codex, Shell on Cursor) through the TOON encoder (~40-60% fewer tokens). On Claude Code the pre-tool hook appends a safe toon-pipe wrapper as the final stage of high-confidence commands (JSON output flags, terminal non-raw jq, learned registry), and the post-tool hook parses actual output as ground truth, replaces it with TOON, and teaches a shared registry so detection improves over time. Cursor cannot replace shell output, so there it is pre-tool source-rewrite only. Codex’s hook contract supports neither a bare pre-tool rewrite nor post-tool output replacement, so on Codex the plugin only learns command signatures into the shared registry (which still sharpens rewrites on the other hosts) — no TOON conversion happens on Codex itself. A gate keeps the common no-op path at ~15ms; no model in the detection loop.',
  keywords: ['toon', 'json', 'tokens', 'hooks', 'bash', 'token-efficiency', 'jq'],
});
