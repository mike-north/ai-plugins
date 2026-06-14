/**
 * Deterministic routing-eval scorer for the `customizations` router skill.
 *
 * Scores a results file (routed verdicts) against the eval set, producing
 * per-case and aggregate metrics. No external dependencies — node: builtins only.
 * No Math.random(), Date.now(), or new Date() calls anywhere.
 *
 * ## Results file shape
 *
 * A JSON array of trial records:
 * ```json
 * [
 *   { "id": "<case id>", "primitive": "<one of the 10>", "scope": "user|project" },
 *   { "id": "<case id>", "tier": "opus|sonnet|haiku", "primitive": "<routed>", "scope": "user|project" }
 * ]
 * ```
 * - `id`        — must match an id from the eval set (unmatched records are ignored with a warning)
 * - `primitive` — must be one of the 10 valid values (unknown treated as non-match)
 * - `scope`     — optional; "user" | "project"
 * - `tier`      — optional; "opus" | "sonnet" | "haiku"
 * One record per trial. Multiple records with the same id (and optionally tier) represent
 * independent trial runs whose results are aggregated.
 *
 * ## Tier strength ordering
 *
 * opus > sonnet > haiku.  "Stronger" means more capable / more expensive.
 * The clarity floor is the *weakest* (cheapest) tier at which ALL cases pass —
 * i.e., haiku (the cheapest) passing is the strongest statement of clarity.
 * We report the lowest-tier in the ordering where every case passes:
 *   opus = 3, sonnet = 2, haiku = 1  (lower number = weaker = cheaper = better floor)
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid routing primitives. */
export const VALID_PRIMITIVES = /** @type {const} */ ([
  "script",
  "memory",
  "rule",
  "hook",
  "skill",
  "agent",
  "mcp",
  "monitor",
  "plugin",
  "marketplace",
]);

/** Valid tier names. */
export const VALID_TIERS = /** @type {const} */ (["opus", "sonnet", "haiku"]);

/**
 * Tier strength: lower number = weaker = cheaper = better clarity-floor signal.
 * haiku=1, sonnet=2, opus=3.
 */
const TIER_STRENGTH = { haiku: 1, sonnet: 2, opus: 3 };

// ---------------------------------------------------------------------------
// Types (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ primitive: string; scope?: string }} EvalExpected
 * @typedef {{ primitive: string; scope?: string }[]} AcceptableAlternatives
 * @typedef {{
 *   id: string;
 *   input: string;
 *   expectedOutcome: string;
 *   expected: EvalExpected;
 *   acceptableAlternatives: AcceptableAlternatives;
 *   mustReject: string[];
 *   tags: string[];
 * }} EvalCase
 *
 * @typedef {{
 *   id: string;
 *   primitive: string;
 *   scope?: string;
 *   tier?: string;
 * }} TrialRecord
 *
 * @typedef {{
 *   id: string;
 *   primaryRate: number;
 *   acceptableRate: number;
 *   scopeMatchRate: number;
 *   mustRejectRate: number;
 *   pass: boolean;
 *   rejectedHits: string[];
 *   tags: string[];
 * }} CaseScore
 *
 * @typedef {{
 *   threshold: number;
 *   overall: { accuracy: number; passed: number; total: number };
 *   perTag: Record<string, { accuracy: number; passed: number; total: number }>;
 *   perTier: Record<string, { accuracy: number; passed: number; total: number }>;
 *   clarityFloor: string | null;
 *   cases: CaseScore[];
 * }} ScoreReport
 */

// ---------------------------------------------------------------------------
// Core: loadJson
// ---------------------------------------------------------------------------

/**
 * Load and parse a JSON file from disk. Returns the parsed value.
 * Throws a descriptive Error if the file does not exist or is not valid JSON.
 *
 * @param {string} filePath
 * @returns {unknown}
 */
export function loadJson(filePath) {
  if (!existsSync(filePath)) {
    throw Object.assign(new Error(`File not found: ${filePath}`), { code: "ENOENT" });
  }
  let raw;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read file: ${filePath}: ${String(err)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in file: ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// Core: scoreCase
// ---------------------------------------------------------------------------

/**
 * Score a single eval case over its N trial records.
 *
 * @param {EvalCase} evalCase
 * @param {TrialRecord[]} trials - all trial records for this case (same id)
 * @param {{ threshold?: number; rejectTolerance?: number }} [opts]
 * @returns {CaseScore}
 */
export function scoreCase(evalCase, trials, opts = {}) {
  const threshold = opts.threshold ?? 0.6;
  const rejectTolerance = opts.rejectTolerance ?? 0;
  const n = trials.length;

  if (n === 0) {
    return {
      id: evalCase.id,
      primaryRate: 0,
      acceptableRate: 0,
      scopeMatchRate: 0,
      mustRejectRate: 0,
      pass: false,
      rejectedHits: [],
      tags: evalCase.tags,
    };
  }

  const expectedPrimitive = evalCase.expected.primitive;
  const expectedScope = evalCase.expected.scope;
  const acceptablePrimitives = new Set(
    (evalCase.acceptableAlternatives ?? []).map((a) => a.primitive),
  );
  const mustRejectSet = new Set(evalCase.mustReject ?? []);

  let primaryHits = 0;
  let primaryScopeHits = 0;
  let acceptableHits = 0;
  let mustRejectHits = 0;
  /** @type {string[]} */
  const rejectedHitsList = [];

  for (const trial of trials) {
    const p = trial.primitive;

    // Primary hit: exact match on primitive
    const isPrimary = p === expectedPrimitive;
    if (isPrimary) {
      primaryHits++;
      // Scope check only among primary hits
      if (expectedScope !== undefined && trial.scope === expectedScope) {
        primaryScopeHits++;
      } else if (expectedScope === undefined) {
        // No expected scope → count as scope-matched
        primaryScopeHits++;
      }
    }

    // Acceptable: primary OR in alternatives
    if (isPrimary || acceptablePrimitives.has(p)) {
      acceptableHits++;
    }

    // Must-reject violation
    if (mustRejectSet.has(p)) {
      mustRejectHits++;
      rejectedHitsList.push(p);
    }
  }

  const primaryRate = primaryHits / n;
  const acceptableRate = acceptableHits / n;
  const scopeMatchRate = primaryHits > 0 ? primaryScopeHits / primaryHits : 0;
  const mustRejectRate = mustRejectHits / n;

  const pass = primaryRate >= threshold && mustRejectRate <= rejectTolerance;

  // Deduplicate rejected primitives for the report
  const rejectedHits = [...new Set(rejectedHitsList)];

  return {
    id: evalCase.id,
    primaryRate,
    acceptableRate,
    scopeMatchRate,
    mustRejectRate,
    pass,
    rejectedHits,
    tags: evalCase.tags,
  };
}

// ---------------------------------------------------------------------------
// Core: scoreAll
// ---------------------------------------------------------------------------

/**
 * Score all eval cases against a results array.
 *
 * Warns (via returned warnings array) about:
 * - result records whose id is not in the eval set (ignored)
 * - result records whose primitive is not in VALID_PRIMITIVES (treated as non-match)
 *
 * @param {EvalCase[]} evalCases
 * @param {TrialRecord[]} results
 * @param {{ threshold?: number; rejectTolerance?: number; tagFilter?: string }} [opts]
 * @returns {{ report: ScoreReport; warnings: string[] }}
 */
export function scoreAll(evalCases, results, opts = {}) {
  const threshold = opts.threshold ?? 0.6;
  const rejectTolerance = opts.rejectTolerance ?? 0;
  const tagFilter = opts.tagFilter;

  const validPrimitiveSet = new Set(VALID_PRIMITIVES);
  const evalById = new Map(evalCases.map((c) => [c.id, c]));

  /** @type {string[]} */
  const warnings = [];

  // Validate and group results: id → tier? → TrialRecord[]
  /** @type {Map<string, Map<string | undefined, TrialRecord[]>>} */
  const groupedResults = new Map();

  for (const r of results) {
    if (!evalById.has(r.id)) {
      warnings.push(`Unknown result id "${r.id}" — ignored`);
      continue;
    }
    if (!validPrimitiveSet.has(r.primitive)) {
      warnings.push(
        `Unknown primitive "${r.primitive}" in result id "${r.id}" — treated as non-match`,
      );
      // Still include as a non-matching trial so rates are computed honestly
    }

    const tier = r.tier;
    if (!groupedResults.has(r.id)) {
      groupedResults.set(r.id, new Map());
    }
    const tierMap = /** @type {Map<string | undefined, TrialRecord[]>} */ (groupedResults.get(r.id));
    if (!tierMap.has(tier)) {
      tierMap.set(tier, []);
    }
    /** @type {TrialRecord[]} */ (tierMap.get(tier)).push(r);
  }

  // Determine which cases to score (apply tag filter)
  const casesToScore = tagFilter
    ? evalCases.filter((c) => c.tags.includes(tagFilter))
    : evalCases;

  /** @type {CaseScore[]} */
  const caseScores = [];

  // Per-tag accumulation
  /** @type {Map<string, { passed: number; total: number }>} */
  const tagAccum = new Map();

  // Per-tier accumulation: tier → case id → pass bool
  /** @type {Map<string, Map<string, boolean>>} */
  const tierCasePass = new Map();

  for (const evalCase of casesToScore) {
    const tierMap = groupedResults.get(evalCase.id);
    const hasTierData = tierMap !== undefined;

    if (hasTierData) {
      // Score per-tier AND overall (no-tier = all trials combined)
      /** @type {TrialRecord[]} */
      const allTrials = [];
      for (const trials of tierMap.values()) {
        allTrials.push(...trials);
      }

      const overall = scoreCase(evalCase, allTrials, { threshold, rejectTolerance });
      caseScores.push(overall);

      // Per-tier breakdown
      for (const [tier, trials] of tierMap.entries()) {
        if (tier === undefined) continue;
        const tierScore = scoreCase(evalCase, trials, { threshold, rejectTolerance });
        if (!tierCasePass.has(tier)) {
          tierCasePass.set(tier, new Map());
        }
        /** @type {Map<string, boolean>} */ (tierCasePass.get(tier)).set(evalCase.id, tierScore.pass);
      }
    } else {
      // No results for this case → score with empty trials
      const score = scoreCase(evalCase, [], { threshold, rejectTolerance });
      caseScores.push(score);
    }

    // Accumulate per-tag stats (from the overall/combined score)
    const caseScore = caseScores[caseScores.length - 1];
    for (const tag of evalCase.tags) {
      if (!tagAccum.has(tag)) {
        tagAccum.set(tag, { passed: 0, total: 0 });
      }
      const acc = /** @type {{ passed: number; total: number }} */ (tagAccum.get(tag));
      acc.total++;
      if (caseScore.pass) acc.passed++;
    }
  }

  // Aggregate overall
  const totalCases = caseScores.length;
  const passedCases = caseScores.filter((c) => c.pass).length;
  const overallAccuracy = totalCases > 0 ? passedCases / totalCases : 0;

  // Per-tag report
  /** @type {Record<string, { accuracy: number; passed: number; total: number }>} */
  const perTag = {};
  for (const [tag, acc] of tagAccum.entries()) {
    perTag[tag] = {
      accuracy: acc.total > 0 ? acc.passed / acc.total : 0,
      passed: acc.passed,
      total: acc.total,
    };
  }

  // Per-tier report + clarity floor
  /** @type {Record<string, { accuracy: number; passed: number; total: number }>} */
  const perTier = {};

  for (const [tier, caseMap] of tierCasePass.entries()) {
    let tierPassed = 0;
    let tierTotal = 0;
    for (const pass of caseMap.values()) {
      tierTotal++;
      if (pass) tierPassed++;
    }
    perTier[tier] = {
      accuracy: tierTotal > 0 ? tierPassed / tierTotal : 0,
      passed: tierPassed,
      total: tierTotal,
    };
  }

  // Clarity floor: the weakest tier (lowest TIER_STRENGTH) where all scored cases pass.
  // We only consider tiers that have results for ALL scored cases.
  const scoredIds = new Set(casesToScore.map((c) => c.id));
  /** @type {string | null} */
  let clarityFloor = null;
  let bestStrength = Infinity; // lower strength = cheaper = better clarity floor

  for (const [tier, caseMap] of tierCasePass.entries()) {
    // Must cover all scored cases
    const coversAll = [...scoredIds].every((id) => caseMap.has(id));
    if (!coversAll) continue;

    const allPass = [...caseMap.values()].every(Boolean);
    if (!allPass) continue;

    const strength = TIER_STRENGTH[/** @type {keyof typeof TIER_STRENGTH} */ (tier)] ?? Infinity;
    if (strength < bestStrength) {
      bestStrength = strength;
      clarityFloor = tier;
    }
  }

  return {
    report: {
      threshold,
      overall: { accuracy: overallAccuracy, passed: passedCases, total: totalCases },
      perTag,
      perTier,
      clarityFloor,
      cases: caseScores,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Core: splitStratified
// ---------------------------------------------------------------------------

/**
 * Deterministically partition case ids into train/test, stratified by expected.primitive.
 *
 * Uses a stable hash of (id + seed) for ordering within each stratum.
 * Never uses Math.random() — same inputs always produce the same split.
 *
 * @param {EvalCase[]} evalCases
 * @param {{ ratio?: number; seed?: number | string }} [opts]
 * @returns {{ train: string[]; test: string[] }}
 */
export function splitStratified(evalCases, opts = {}) {
  const ratio = opts.ratio ?? 0.6;
  const seed = String(opts.seed ?? 1);

  // Group cases by primitive
  /** @type {Map<string, EvalCase[]>} */
  const byPrimitive = new Map();
  for (const c of evalCases) {
    const p = c.expected.primitive;
    if (!byPrimitive.has(p)) {
      byPrimitive.set(p, []);
    }
    /** @type {EvalCase[]} */ (byPrimitive.get(p)).push(c);
  }

  /** @type {string[]} */
  const train = [];
  /** @type {string[]} */
  const test = [];

  for (const [, cases] of byPrimitive.entries()) {
    // Sort by stable hash of id + seed
    const sorted = [...cases].sort((a, b) => {
      const ha = stableHash(`${a.id}::${seed}`);
      const hb = stableHash(`${b.id}::${seed}`);
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });

    const trainCount = Math.round(sorted.length * ratio);
    for (let i = 0; i < sorted.length; i++) {
      (i < trainCount ? train : test).push(sorted[i].id);
    }
  }

  return { train, test };
}

/**
 * Return a hex digest string (SHA-256) for the given string.
 * Used exclusively for deterministic ordering — never for security.
 *
 * @param {string} input
 * @returns {string}
 */
function stableHash(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

/**
 * Print usage to stderr and exit with code 2.
 * @param {string} [message]
 * @returns {never}
 */
function usageError(message) {
  if (message) {
    process.stderr.write(`Error: ${message}\n\n`);
  }
  process.stderr.write(
    `Usage:
  node score.mjs score --evals <path> --results <path> [--threshold 0.6] [--reject-tolerance 0] [--tag <tag>] [--json]
  node score.mjs split --evals <path> [--ratio 0.6] [--seed 1]

Subcommands:
  score   Score a results file against the eval set.
  split   Deterministically partition case ids into train/test sets.

Options for score:
  --evals <path>             Path to routing-evals.json
  --results <path>           Path to results JSON (array of trial records)
  --threshold <float>        Minimum primaryRate for a case to pass (default 0.6)
  --reject-tolerance <float> Maximum allowed mustRejectRate (default 0, i.e. any hit fails)
  --tag <tag>                Filter to cases with this tag
  --json                     Output machine-readable JSON instead of human-readable table

Options for split:
  --evals <path>             Path to routing-evals.json
  --ratio <float>            Fraction of each stratum to assign to train (default 0.6)
  --seed <value>             Seed for deterministic shuffling within strata (default 1)
`,
  );
  process.exit(2);
}

/**
 * Parse argv-style arguments into a plain object.
 * Flags like --foo bar → { foo: "bar" }
 * Flags like --json → { json: true }
 *
 * @param {string[]} argv
 * @returns {Record<string, string | true>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | true>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

/**
 * Load JSON from path, exiting with code 1 on error.
 * @param {string} p
 * @returns {unknown}
 */
function loadOrExit(p) {
  try {
    return loadJson(p);
  } catch (err) {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  }
}

/**
 * Format a float as a percentage string.
 * @param {number} v
 * @returns {string}
 */
function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Pad a string on the right.
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
function rpad(s, n) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/**
 * Pad a string on the left.
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
function lpad(s, n) {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

// ---------------------------------------------------------------------------
// CLI: score subcommand
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, string | true>} args
 * @returns {void}
 */
function cmdScore(args) {
  const evalsPath = args["evals"];
  const resultsPath = args["results"];

  if (!evalsPath || evalsPath === true) usageError("--evals <path> is required");
  if (!resultsPath || resultsPath === true) usageError("--results <path> is required");

  const threshold =
    args["threshold"] && args["threshold"] !== true ? parseFloat(String(args["threshold"])) : 0.6;
  const rejectTolerance =
    args["reject-tolerance"] && args["reject-tolerance"] !== true
      ? parseFloat(String(args["reject-tolerance"]))
      : 0;
  const tagFilter =
    args["tag"] && args["tag"] !== true ? String(args["tag"]) : undefined;
  const jsonOutput = args["json"] === true;

  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    usageError("--threshold must be a number between 0 and 1");
  }
  if (isNaN(rejectTolerance) || rejectTolerance < 0 || rejectTolerance > 1) {
    usageError("--reject-tolerance must be a number between 0 and 1");
  }

  const rawEvals = loadOrExit(String(evalsPath));
  const rawResults = loadOrExit(String(resultsPath));

  if (!Array.isArray(rawEvals)) {
    process.stderr.write("Evals file must be a JSON array\n");
    process.exit(1);
  }
  if (!Array.isArray(rawResults)) {
    process.stderr.write("Results file must be a JSON array\n");
    process.exit(1);
  }

  const evalCases = /** @type {EvalCase[]} */ (rawEvals);
  const results = /** @type {TrialRecord[]} */ (rawResults);

  const { report, warnings } = scoreAll(evalCases, results, {
    threshold,
    rejectTolerance,
    tagFilter,
  });

  if (warnings.length > 0) {
    for (const w of warnings) {
      process.stderr.write(`Warning: ${w}\n`);
    }
  }

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  // Human-readable output
  const { overall, perTag, perTier, clarityFloor, cases } = report;

  process.stdout.write("=== Routing Eval Score Report ===\n\n");
  process.stdout.write(
    `Threshold: primaryRate >= ${threshold}  |  reject-tolerance: ${rejectTolerance}\n`,
  );
  if (tagFilter) process.stdout.write(`Tag filter: ${tagFilter}\n`);
  process.stdout.write("\n");

  // Overall
  const passEmoji = overall.accuracy === 1 ? "PASS" : "FAIL";
  process.stdout.write(
    `Overall accuracy: ${pct(overall.accuracy)}  (${overall.passed}/${overall.total} cases passed)  [${passEmoji}]\n\n`,
  );

  // Per-tag
  if (Object.keys(perTag).length > 0) {
    process.stdout.write("Per-tag accuracy:\n");
    const maxTagLen = Math.max(...Object.keys(perTag).map((t) => t.length), 4);
    for (const [tag, acc] of Object.entries(perTag)) {
      process.stdout.write(
        `  ${rpad(tag, maxTagLen)}  ${lpad(pct(acc.accuracy), 6)}  (${acc.passed}/${acc.total})\n`,
      );
    }
    process.stdout.write("\n");
  }

  // Per-tier
  if (Object.keys(perTier).length > 0) {
    process.stdout.write("Per-tier accuracy:\n");
    for (const [tier, acc] of Object.entries(perTier)) {
      process.stdout.write(
        `  ${rpad(tier, 8)}  ${lpad(pct(acc.accuracy), 6)}  (${acc.passed}/${acc.total})\n`,
      );
    }
    process.stdout.write(
      `Clarity floor: ${clarityFloor ?? "none"}\n`,
    );
    process.stdout.write("\n");
  }

  // Case table
  const cols = {
    id: 40,
    primary: 9,
    accept: 9,
    scope: 7,
    reject: 8,
    pass: 6,
    tags: 0,
  };

  process.stdout.write(
    rpad("ID", cols.id) +
      lpad("primary", cols.primary) +
      lpad("accept", cols.accept) +
      lpad("scope%", cols.scope) +
      lpad("reject%", cols.reject) +
      lpad(" pass", cols.pass) +
      "\n",
  );
  process.stdout.write("-".repeat(cols.id + cols.primary + cols.accept + cols.scope + cols.reject + cols.pass) + "\n");

  for (const c of cases) {
    const passStr = c.pass ? "PASS" : "FAIL";
    process.stdout.write(
      rpad(c.id, cols.id) +
        lpad(pct(c.primaryRate), cols.primary) +
        lpad(pct(c.acceptableRate), cols.accept) +
        lpad(pct(c.scopeMatchRate), cols.scope) +
        lpad(pct(c.mustRejectRate), cols.reject) +
        lpad(passStr, cols.pass) +
        "\n",
    );
  }
  process.stdout.write("\n");

  // Failing cases detail
  const failing = cases.filter((c) => !c.pass);
  if (failing.length > 0) {
    process.stdout.write(`Failing cases (${failing.length}):\n`);
    for (const c of failing) {
      process.stdout.write(`  [${c.id}]\n`);
      process.stdout.write(`    primaryRate=${pct(c.primaryRate)}  acceptableRate=${pct(c.acceptableRate)}  mustRejectRate=${pct(c.mustRejectRate)}\n`);
      if (c.rejectedHits.length > 0) {
        process.stdout.write(`    rejected primitives hit: ${c.rejectedHits.join(", ")}\n`);
      }
      process.stdout.write(`    tags: ${c.tags.join(", ")}\n`);
    }
  } else {
    process.stdout.write("All cases passed.\n");
  }
}

// ---------------------------------------------------------------------------
// CLI: split subcommand
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, string | true>} args
 * @returns {void}
 */
function cmdSplit(args) {
  const evalsPath = args["evals"];
  if (!evalsPath || evalsPath === true) usageError("--evals <path> is required");

  const ratio =
    args["ratio"] && args["ratio"] !== true ? parseFloat(String(args["ratio"])) : 0.6;
  const seed = args["seed"] !== undefined && args["seed"] !== true ? args["seed"] : "1";

  if (isNaN(ratio) || ratio < 0 || ratio > 1) {
    usageError("--ratio must be a number between 0 and 1");
  }

  const rawEvals = loadOrExit(String(evalsPath));
  if (!Array.isArray(rawEvals)) {
    process.stderr.write("Evals file must be a JSON array\n");
    process.exit(1);
  }

  const evalCases = /** @type {EvalCase[]} */ (rawEvals);
  const result = splitStratified(evalCases, { ratio, seed });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// CLI dispatch (guarded behind import.meta.url check)
// ---------------------------------------------------------------------------

// pathToFileURL handles the case where argv[1] may be a plain path or already
// a URL string. fileURLToPath(argv[1]) would throw when vitest passes its own
// internal worker URL as argv[1].
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  const args = parseArgs(argv.slice(1));

  if (subcommand === "score") {
    cmdScore(args);
  } else if (subcommand === "split") {
    cmdSplit(args);
  } else {
    usageError(
      subcommand ? `Unknown subcommand: ${subcommand}` : "A subcommand (score | split) is required",
    );
  }
}
