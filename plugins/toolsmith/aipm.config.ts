import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: '0.6.0',
  targets: ['claude', 'cursor', 'codex', 'open-plugins'],
  description:
    "Guides an agent to forge narrow, single-purpose, user-approvable scripts instead of hand-assembling broad escape-hatch commands (gh api, raw curl, aws/gcloud/kubectl). A PreToolUse hook redirects watched commands to an already-approved script when one covers them, and hard-blocks any approved script whose contents changed since approval (sha256-pinned). A PostToolUse hook logs Bash usage so /toolsmith:analyze can mine it for tools worth building; /toolsmith:approve runs the proofread-then-allowlist handshake.",
  keywords: ['permissions', 'hooks', 'bash', 'scripts', 'allowlist', 'gh', 'agents', 'security'],
});
