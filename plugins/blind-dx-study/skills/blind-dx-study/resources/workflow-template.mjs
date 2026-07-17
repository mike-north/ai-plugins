/**
 * BLIND DX USABILITY STUDY — runnable Workflow template.
 *
 * Copy this into a Workflow `script`, fill the four <<FILL>> zones, and run. It is deliberately
 * SELF-CONTAINED (schemas + prompt preamble inlined) because the Workflow harness runs each
 * script in isolation and does not resolve local imports. `schemas.mjs` and `prompt-builder.mjs`
 * in this folder are the annotated source-of-truth for the inlined blocks — read them to
 * understand each field; edit them if you want to evolve the shared shape.
 *
 * Pipeline shape (do not change without reason):
 *   Subjects  → pipeline stage 1: each blind subject runs its scenario, returns SUBJECT_SCHEMA
 *   Verify    → pipeline stage 2: each subject's functional claims are independently reproduced
 *               (capped per subject) BEFORE they can be weighted — this is what keeps stale
 *               doc-misquotes and subject misuse from masking real convergence
 *   Synthesize→ one high-effort agent dedupes/ranks across cohorts, compares to the baseline,
 *               and makes the convergence call
 *
 * Inputs (pass via Workflow `args` as a JSON object):
 *   { "root": "/abs/path/to/study-root", "artifacts": "/abs/path/to/installables", ... }
 *   `root` is where per-subject workspaces live; `artifacts` is wherever the installable target
 *   lives (a tarball dir, a local registry, etc). Add whatever else your install/safety strings need.
 */

export const meta = {
  name: 'blind-dx-usability-study', // <<FILL: give this run a distinct name, e.g. include a wave/date
  description: 'Blind DX usability study: fresh-eyes subjects → verify claims → convergence verdict',
  phases: [
    { title: 'Subjects', detail: 'blind subjects run their scenarios (sonnet)' },
    { title: 'Verify', detail: 'independently reproduce claimed breakage/blockers' },
    { title: 'Synthesize', detail: 'dedupe, rank, compare to baseline, convergence call' },
  ],
};

// The Workflow harness sometimes delivers `args` as a JSON string — parse defensively.
const _args = typeof args === 'string' ? JSON.parse(args) : args;
const ROOT = _args.root;
const ARTIFACTS = _args.artifacts;
if (!ROOT || !ARTIFACTS) throw new Error(`args not resolved: root=${ROOT} artifacts=${ARTIFACTS}`);

const SEVERITIES = ['blocker', 'major', 'minor', 'papercut'];

// ── Inlined schemas (see schemas.mjs for the annotated originals) ────────────────────────────
const SUBJECT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['taskCompleted', 'progressSummary', 'frictionEvents', 'brokenFeatures', 'easeRating', 'timeProxy', 'topThreeFixes'],
  properties: {
    taskCompleted: { type: 'boolean' },
    progressSummary: { type: 'string' },
    frictionEvents: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['stage', 'severity', 'description', 'expectedVsActual'], properties: {
      stage: { type: 'string' }, severity: { enum: SEVERITIES }, description: { type: 'string' }, expectedVsActual: { type: 'string' }, docQuote: { type: 'string' }, workaround: { type: 'string' }, repro: { type: 'string' } } } },
    brokenFeatures: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'repro', 'observed', 'expected'], properties: {
      title: { type: 'string' }, repro: { type: 'string' }, observed: { type: 'string' }, expected: { type: 'string' } } } },
    easeRating: { type: 'number', description: '1-10 against "incredibly easy to understand and use"' },
    timeProxy: { type: 'string' },
    topThreeFixes: { type: 'array', items: { type: 'string' } },
  },
};
const VERDICT_SCHEMA = { type: 'object', additionalProperties: false, required: ['confirmed', 'actualBehavior', 'notes'], properties: {
  confirmed: { type: 'boolean' }, actualBehavior: { type: 'string' }, notes: { type: 'string' } } };
const SYNTHESIS_SCHEMA = { type: 'object', additionalProperties: false, required: ['findings', 'easeSummary', 'baselineComparison', 'verdict', 'quickWins', 'deeperWork'], properties: {
  findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'severity', 'surface', 'subjectsAffected', 'verificationStatus', 'isNewSinceBaseline', 'description', 'recommendation'], properties: {
    title: { type: 'string' }, severity: { enum: SEVERITIES }, surface: { type: 'string' }, subjectsAffected: { type: 'array', items: { type: 'string' } },
    verificationStatus: { enum: ['confirmed', 'not-reproduced', 'not-verified-subjective'] }, isNewSinceBaseline: { type: 'boolean' },
    description: { type: 'string' }, repro: { type: 'string' }, recommendation: { type: 'string' } } } },
  easeSummary: { type: 'string' }, baselineComparison: { type: 'string' }, verdict: { type: 'string' },
  quickWins: { type: 'array', items: { type: 'string' } }, deeperWork: { type: 'array', items: { type: 'string' } } } };

// ── Shared subject preamble (see prompt-builder.mjs for the annotated original) ───────────────
function subjectPreamble(ws, cohort, docRule, installRule, safetyRule) {
  return `You are a developer trying the target under study for the very first time, as a blind usability-study test subject (cohort ${cohort}). Evaluate it against a very high bar: it should be INCREDIBLY easy to understand and use, with a streamlined getting-started experience. Every point of confusion, retry, or doc mismatch is a finding — record it.

WORKSPACE & BLINDING (strict):
- Your workspace is ${ws} — do ALL work there. It already exists.
- NEVER read, list, or reference the target's source tree, its tests, or its git history, and never fetch its source repository to read implementation. You only know what a fresh user knows.
- ${docRule}

INSTALL:
- ${installRule}
- If a step needs something you weren't given, that's a finding — record it and stop that step; do not route around the public interface.

SAFETY (strict — never touch real machine state):
- ${safetyRule}
- Never write to real credential stores, OS keychains, the real ~/.config, or real accounts. Use only obviously-fake placeholder values.
- If you cannot find a DOCUMENTED way to keep an operation sandboxed, STOP before running it and record a blocker.

CONDUCT: behave like a persistent, competent developer; on failure, attempt self-service recovery (~3 attempts per obstacle), logging each. If blocked, record the blocker and continue evaluating whatever else you can. Bounded effort.

REPORTING: return your report via the structured output tool. Include exact self-contained repro for functional issues. Quote misleading docs verbatim in docQuote. Rate easeRating honestly (10 = zero friction).`;
}

// <<FILL 1: install + safety strings for THIS target (reference ARTIFACTS/ROOT as needed) ───────
const DOC_A = (ws) => `Documentation available: the folder ${ws}/docs contains the docs a user could plausibly find (README + an API reference). You may read anything under ${ws}/docs.`;
const DOC_B = `You have NO external docs folder. Use ONLY the installed package's own shipped README/metadata/type declarations plus --help / error output. Do NOT web-search for the target's docs, and do NOT read its source repository. Reading the installed package's own shipped README IS allowed — it is what a registry user sees.`;
const INSTALL = `Install the target from ${ARTIFACTS} exactly as a user would. <<FILL: the concrete install command(s)>>`;
// SAFETY is a function of the workspace so each subject/verifier gets its OWN sandbox path
// substituted — never a shared literal. `${ws}` below interpolates the real workspace dir.
const SAFETY = (ws) => `<<FILL: the exact sandbox mechanism for workspace ${ws}, e.g. "use an isolated home: mkdir -p ${ws}/home && HOME=${ws}/home <cmd> ...">>`;

// <<FILL 2: the scenarios. One entry per subject. Split across cohort A (has docs) and B (blind).
const TASKS = [
  // { id: 'A1-quickstart', cohort: 'A', ws: `${ROOT}/subject-01`, task: 'TASK: <<the scenario, and exactly what to judge>>' },
  // { id: 'B7-types-only', cohort: 'B', ws: `${ROOT}/subject-07`, task: 'TASK: <<...>>' },
];
if (TASKS.length === 0) throw new Error('Fill in TASKS before running.');

// <<FILL 3: baseline context for synthesis — prior wave/release ease + its still-open findings,
// or "first run, establish the baseline" if there is none.
const BASELINE_CONTEXT = `<<FILL: e.g. "Prior wave scored 8.4 overall (cohort A 8.25, cohort B 9.0). Still-open findings: (1) ...; (2) .... For each, say RESOLVED or PERSISTS. Also assess any newly-introduced behavior. Flag NEW regressions.">>`;

// ── Stage 1+2: subjects, each immediately followed by verification of its own claims ──────────
phase('Subjects');
log(`Dispatching ${TASKS.length} blind subjects`);

const results = await pipeline(
  TASKS,
  (t) => agent(
    `${subjectPreamble(t.ws, t.cohort, t.cohort === 'A' ? DOC_A(t.ws) : DOC_B, INSTALL, SAFETY(t.ws))}\n\n${t.task}`,
    { label: `subject:${t.id}`, phase: 'Subjects', schema: SUBJECT_SCHEMA, model: 'sonnet', agentType: 'dx-evaluator' },
  ),
  async (report, t) => {
    if (!report) return null;
    const claims = [];
    for (const bf of report.brokenFeatures) claims.push({ kind: 'brokenFeature', title: bf.title, repro: bf.repro, observed: bf.observed, expected: bf.expected });
    for (const fe of report.frictionEvents) if (fe.severity === 'blocker' && fe.repro) claims.push({ kind: 'blocker', title: fe.description.slice(0, 80), repro: fe.repro, observed: fe.expectedVsActual, expected: '' });
    const capped = claims.slice(0, 4); // cap verification fan-out per subject
    if (claims.length > capped.length) log(`subject ${t.id}: verifying ${capped.length} of ${claims.length} claims (capped)`);
    const verdicts = await parallel(capped.map((c, i) => () =>
      agent(
        `You are verifying one functional claim from a blind DX study. Work ONLY in fresh workspace ${t.ws}-verify-${i} (mkdir -p). Never read the target's source. Stay sandboxed: ${SAFETY(`${t.ws}-verify-${i}`)} Never touch real credential stores; use only fake values. INSTALL: ${INSTALL}\n\nCLAIM (${c.kind}): ${c.title}\nREPRO:\n${c.repro}\nOBSERVED: ${c.observed}\n${c.expected ? `EXPECTED: ${c.expected}` : ''}\n\nFollow the repro in a fresh setup. Be skeptical — subjects sometimes misuse the tool or quote a stale/truncated snippet. confirmed=true ONLY if you reproduce the problematic behavior (or a materially equivalent failure). Report exact actual behavior; if not confirmed, say how the repro was wrong.`,
        { label: `verify:${t.id}#${i}`, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'dx-claim-verifier' },
      ).then((v) => ({ claim: c, verdict: v })),
    ));
    return { taskId: t.id, cohort: t.cohort, report, verifications: verdicts.filter(Boolean) };
  },
);

const completed = results.filter(Boolean);
log(`${completed.length}/${TASKS.length} subjects done; synthesizing`);

// ── Stage 3: synthesis / convergence call ────────────────────────────────────────────────────
phase('Synthesize');
const synthesis = await agent(
  `You are synthesizing a BLIND DX usability study. Each blind subject ran a scenario; every functional claim was independently re-tested (see verifications[].verdict.confirmed). Decide whether the target is now UNIFORMLY "incredibly easy to understand and use".

BASELINE / TREND CONTEXT:
${BASELINE_CONTEXT}

CRITICAL DISCIPLINE: for ANY "crashes/fails as written" claim, CHECK verifications[].verdict.confirmed BEFORE weighting it. Unconfirmed claims are usually subject misuse or stale doc-misquotes — do NOT let one drag the verdict down or mask genuine convergence. Distinguish confirmed defects from not-reproduced noise explicitly.

Produce:
- findings: deduplicated, ranked by (severity × subjects affected × confirmed). Set isNewSinceBaseline per the context. Set verificationStatus from the verdicts. Include repro for functional ones.
- easeSummary: ease per cohort + overall, and the trend vs the baseline.
- baselineComparison: go finding-by-finding through the baseline's open items — RESOLVED vs PERSISTS with evidence — and flag any NEW regression.
- verdict: the convergence call — yes / partly / no + gating reasons. If it is genuinely, uniformly "incredibly easy" now across first-run AND every probed surface, say YES plainly; if a real confirmed defect remains, name it precisely.
- quickWins (mechanical) and deeperWork (design).

Raw data (JSON):
${JSON.stringify(completed, null, 1)}`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTHESIS_SCHEMA, effort: 'high' },
);

return { synthesis, completed };
