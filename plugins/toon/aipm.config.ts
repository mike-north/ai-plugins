import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: '0.1.0',
  targets: ['claude', 'codex', 'cursor'],
  description:
    'Deterministic hook pair that routes JSON-emitting Bash commands through the TOON encoder (~40-60% fewer tokens). PreToolUse appends a safe toon-pipe wrapper as the final stage of high-confidence commands (JSON output flags, terminal non-raw jq, learned registry); PostToolUse parses actual output as ground truth, replaces it with TOON, and teaches a shared registry so detection improves over time. A bash gate keeps the common no-op path at ~15ms; no model in the detection loop.',
  keywords: ['toon', 'json', 'tokens', 'hooks', 'bash', 'token-efficiency', 'jq'],
});
