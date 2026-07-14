import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: '0.2.0',
  targets: ['claude', 'codex', 'cursor'],
  description:
    'Deterministic hook pair that routes JSON-emitting shell commands (Bash on Claude Code/Codex, Shell on Cursor) through the TOON encoder (~40-60% fewer tokens). The pre-tool hook appends a safe toon-pipe wrapper as the final stage of high-confidence commands (JSON output flags, terminal non-raw jq, learned registry). On Claude Code/Codex the post-tool hook also parses actual output as ground truth, replaces it with TOON, and teaches a shared registry so detection improves over time; Cursor cannot replace shell output, so there it is source-rewrite only. A gate keeps the common no-op path at ~15ms; no model in the detection loop.',
  keywords: ['toon', 'json', 'tokens', 'hooks', 'bash', 'token-efficiency', 'jq'],
});
