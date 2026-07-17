import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: '0.0.1',
  targets: ['claude', 'codex', 'cursor'],
  description:
    'Run a blind developer-experience usability study: fan out fresh-eyes subject agents that only see what a real first-time user would (published packages, findable docs, --help), never the source tree, capture ranked friction findings against an "incredibly easy" bar, independently reproduce every functional claim before weighting it, and synthesize a convergence verdict across cohorts and waves. Pairs with an eng fleet to close the measure-fix-remeasure loop.',
  keywords: [
    'usability',
    'developer-experience',
    'dx',
    'evaluation',
    'blind-study',
    'agents',
    'workflow',
    'onboarding',
  ],
});
