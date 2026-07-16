/**
 * Structured-output JSON schemas for a blind DX usability study.
 *
 * Three stages, three schemas:
 * - SUBJECT_SCHEMA   — what each blind subject returns after running its scenario.
 * - VERDICT_SCHEMA   — what a claim-verifier returns after trying to reproduce one claim.
 * - synthesisSchema(baselineLabel) — the deduped, ranked, cross-cohort convergence call.
 *
 * These are Workflow-tool StructuredOutput schemas (plain JSON Schema). Import them into a
 * workflow script and pass as the `schema` option to agent(). They are target-agnostic: no
 * package names, versions, or per-target findings live here — those belong in the prompts.
 */

export const SEVERITIES = ['blocker', 'major', 'minor', 'papercut'];

/** One subject's full report for its scenario. */
export const SUBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'taskCompleted',
    'progressSummary',
    'frictionEvents',
    'brokenFeatures',
    'easeRating',
    'timeProxy',
    'topThreeFixes',
  ],
  properties: {
    taskCompleted: { type: 'boolean' },
    progressSummary: { type: 'string' },
    frictionEvents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['stage', 'severity', 'description', 'expectedVsActual'],
        properties: {
          stage: { type: 'string' },
          severity: { enum: SEVERITIES },
          description: { type: 'string' },
          expectedVsActual: { type: 'string' },
          docQuote: { type: 'string', description: 'verbatim misleading doc text, if any' },
          workaround: { type: 'string' },
          repro: { type: 'string', description: 'exact self-contained steps for functional friction' },
        },
      },
    },
    brokenFeatures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'repro', 'observed', 'expected'],
        properties: {
          title: { type: 'string' },
          repro: { type: 'string' },
          observed: { type: 'string' },
          expected: { type: 'string' },
        },
      },
    },
    easeRating: {
      type: 'number',
      description: '1-10 against the bar "incredibly easy to understand and use" (10 = zero friction)',
    },
    timeProxy: { type: 'string', description: 'attempt counts / a proxy for effort spent' },
    topThreeFixes: { type: 'array', items: { type: 'string' } },
  },
};

/** A verifier's verdict on a single functional claim. */
export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmed', 'actualBehavior', 'notes'],
  properties: {
    confirmed: { type: 'boolean', description: 'true ONLY if the problematic behavior actually reproduced' },
    actualBehavior: { type: 'string' },
    notes: { type: 'string', description: 'if not confirmed, how the repro was wrong (truncation, missing step, stale quote)' },
  },
};

/**
 * The synthesis schema. Pass a `baselineLabel` (e.g. "wave-3" or "the previous release") so the
 * field docs name the comparison point the synthesizer must go finding-by-finding against; if you
 * have no baseline (a first run), pass null and the comparison fields become free-form.
 */
export function synthesisSchema(baselineLabel = null) {
  const cmp = baselineLabel
    ? `Compare this run's ease + findings to ${baselineLabel}. For EACH prior remaining finding, state RESOLVED (subjects no longer hit it) or PERSISTS with evidence. Flag any NEW regression.`
    : 'This is the first run — establish the baseline: overall and per-cohort ease, and the finding set that future runs will be measured against.';
  return {
    type: 'object',
    additionalProperties: false,
    required: ['findings', 'easeSummary', 'baselineComparison', 'verdict', 'quickWins', 'deeperWork'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'severity',
            'surface',
            'subjectsAffected',
            'verificationStatus',
            'isNewSinceBaseline',
            'description',
            'recommendation',
          ],
          properties: {
            title: { type: 'string' },
            severity: { enum: SEVERITIES },
            surface: { type: 'string', description: 'which surface: library / CLI / SDK / docs / install / ...' },
            subjectsAffected: { type: 'array', items: { type: 'string' } },
            verificationStatus: { enum: ['confirmed', 'not-reproduced', 'not-verified-subjective'] },
            isNewSinceBaseline: {
              type: 'boolean',
              description: 'true if it did NOT appear in the baseline — a regression or newly-surfaced issue',
            },
            description: { type: 'string' },
            repro: { type: 'string' },
            recommendation: { type: 'string' },
          },
        },
      },
      easeSummary: { type: 'string', description: 'ease ratings per cohort and overall, plus the trend' },
      baselineComparison: { type: 'string', description: cmp },
      verdict: {
        type: 'string',
        description:
          'The convergence call: is the target now "incredibly easy to understand and use, streamlined getting-started, easy to build on top of, well-suited for its purpose"? yes / partly / no + the gating reasons.',
      },
      quickWins: { type: 'array', items: { type: 'string' }, description: 'mechanical fixes' },
      deeperWork: { type: 'array', items: { type: 'string' }, description: 'design-level work' },
    },
  };
}
