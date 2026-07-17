/**
 * Prompt builders for blind DX study subjects and verifiers.
 *
 * These assemble the *blinding + isolation + conduct + reporting* preamble that every subject
 * shares, so a workflow script only has to supply the target-specific bits (how to install it,
 * how to sandbox it, and the actual scenario task). Keeping the invariants here — rather than
 * copy-pasted into each task — is what stops a wave from silently dropping a safety clause.
 *
 * Nothing here is tied to a language or package manager; you pass the concrete install and
 * sandbox instructions in as strings.
 */

/**
 * Build the shared subject preamble.
 *
 * @param {object} o
 * @param {string} o.workspace   Absolute path to this subject's workspace (must already exist).
 * @param {'A'|'B'} o.cohort     'A' = has a docs folder; 'B' = registry/types/--help only.
 * @param {string} o.targetName  Human name of the thing under study (e.g. "the acme-sdk package ecosystem").
 * @param {string} o.docRule     What docs the subject may read. For cohort A, point at the in-workspace
 *                               docs folder; for cohort B, the "only the installed package + --help" rule.
 * @param {string} o.installRule How to obtain/install the target as a user would (registry install,
 *                               pre-release tarball paths, a documented bootstrap command, ...).
 * @param {string} o.safetyRule  The exact sandbox mechanism for this target (isolated HOME, --config-dir,
 *                               in-memory backend, fake-value guidance). Name the concrete command form.
 * @param {string} [o.bar]       The quality bar to grade against. Defaults to "incredibly easy".
 * @returns {string}
 */
export function subjectPreamble({ workspace, cohort, targetName, docRule, installRule, safetyRule, bar }) {
  const barText = bar ?? 'it should be INCREDIBLY easy to understand and use, with a streamlined getting-started experience';
  return `You are a developer trying ${targetName} for the very first time, as a blind usability-study test subject (cohort ${cohort}). Evaluate it against a very high bar: ${barText}. Every point of confusion, retry, or doc mismatch is a finding — record it.

WORKSPACE & BLINDING (strict):
- Your workspace is ${workspace} — do ALL work there. It already exists.
- NEVER read, list, or reference the target's source tree, its tests, or its git history, and never fetch its source repository to read implementation. You only know what a fresh user knows.
- ${docRule}

INSTALL:
- ${installRule}
- If a step needs something you weren't given access to, that's a finding — record it and stop that step; do not route around the public interface.

SAFETY (strict — never touch real machine state):
- ${safetyRule}
- Never write to real credential stores, OS keychains, the real ~/.config, or real accounts. Use only obviously-fake placeholder values.
- If you cannot find a DOCUMENTED way to keep an operation sandboxed, STOP before running it and record a blocker — do not risk real state to finish a task.

CONDUCT: behave like a persistent, competent developer; on failure, attempt self-service recovery (~3 attempts per obstacle), logging each. If blocked, record the blocker and continue evaluating whatever else you can. Bounded effort — this is a usability probe, not a mission to succeed at all costs.

REPORTING: return your report via the structured output tool. Include exact, self-contained repro for every functional issue. Quote misleading docs verbatim in docQuote. Rate easeRating honestly against the bar (10 = zero friction).`;
}

/** Convenience: the standard cohort-A / cohort-B doc rules given a docs folder path. */
export function docRuleForCohort(cohort, docsPath) {
  return cohort === 'A'
    ? `Documentation available: the folder ${docsPath} contains the docs a user could plausibly find (e.g. README + an API reference). You may read anything under ${docsPath}.`
    : `You have NO external documentation folder. You may use ONLY the installed package's own contents (its shipped README if present, package metadata, and type declarations) plus --help / error output. Do NOT web-search for the target's docs. Reading the installed package's own shipped README IS allowed — it is what a registry user sees.`;
}

/**
 * Build a verifier prompt for one functional claim.
 *
 * @param {object} o
 * @param {string} o.workspace   Fresh workspace for this verification (the verifier will mkdir it).
 * @param {string} o.installRule How to install the target(s) the claim needs.
 * @param {string} o.safetyRule  The same sandbox mechanism the subjects used.
 * @param {{kind:string,title:string,repro:string,observed:string,expected?:string}} o.claim
 * @returns {string}
 */
export function verifierPrompt({ workspace, installRule, safetyRule, claim }) {
  return `You are verifying a single functional claim from a blind DX usability study. Work ONLY in the fresh workspace ${workspace} (mkdir -p it). Never read the target's source tree. Stay sandboxed: ${safetyRule} Never touch real credential stores/keychains; use only fake values.

INSTALL: ${installRule}

CLAIM (${claim.kind}): ${claim.title}
REPRO STEPS:
${claim.repro}
OBSERVED: ${claim.observed}
${claim.expected ? `EXPECTED: ${claim.expected}` : ''}

Follow the repro in a fresh setup. Determine whether the claimed behavior actually occurs. Be skeptical — subjects sometimes misuse the tool or quote a stale/truncated snippet. Set confirmed=true ONLY if you reproduce the problematic behavior (or a materially equivalent failure). Report the exact actual behavior, and if not confirmed, say precisely how the repro was wrong.`;
}
