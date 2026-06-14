/**
 * Tests for plugins/customizations/evals/score.mjs
 *
 * All test data is fixed — no Math.random(), Date.now(), or new Date() anywhere.
 *
 * @see routing-evals.json for the canonical eval-set shape
 */

import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

// Load the scorer. We import it as a module — the CLI dispatch is guarded
// behind `import.meta.url === fileURLToPath(process.argv[1])` so it won't fire.
import {
  loadJson,
  scoreCase,
  scoreAll,
  splitStratified,
  VALID_PRIMITIVES,
} from "../evals/score.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @returns {import('../evals/score.mjs').EvalCase} */
function makeCase(overrides = {}) {
  return {
    id: "test-case",
    input: "some intent",
    expectedOutcome: "rationale",
    expected: { primitive: "script", scope: "project" },
    acceptableAlternatives: [],
    mustReject: [],
    tags: ["tag-a"],
    ...overrides,
  };
}

/** @returns {import('../evals/score.mjs').TrialRecord} */
function makeTrial(overrides = {}) {
  return {
    id: "test-case",
    primitive: "script",
    scope: "project",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// loadJson
// ---------------------------------------------------------------------------

describe("loadJson", () => {
  it("parses a valid JSON file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "score-test-"));
    try {
      const p = path.join(tmpDir, "data.json");
      fs.writeFileSync(p, JSON.stringify({ hello: "world" }), "utf-8");
      const result = loadJson(p);
      expect(result).toEqual({ hello: "world" });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws with ENOENT code for a missing file", () => {
    expect(() => loadJson("/nonexistent/path/to/file.json")).toThrow("File not found");
  });

  it("throws for malformed JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "score-test-"));
    try {
      const p = path.join(tmpDir, "bad.json");
      fs.writeFileSync(p, "{ not valid json", "utf-8");
      expect(() => loadJson(p)).toThrow("Invalid JSON");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// scoreCase — rate math
// ---------------------------------------------------------------------------

describe("scoreCase — rate math", () => {
  it("computes primaryRate correctly over 5 trials", () => {
    const c = makeCase({ expected: { primitive: "script", scope: "project" } });
    const trials = [
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "hook" }),
      makeTrial({ primitive: "hook" }),
      makeTrial({ primitive: "script" }),
    ];
    const score = scoreCase(c, trials);
    expect(score.primaryRate).toBeCloseTo(3 / 5);
  });

  it("computes acceptableRate including primary + alternatives", () => {
    const c = makeCase({
      expected: { primitive: "script", scope: "project" },
      acceptableAlternatives: [{ primitive: "hook", scope: "project" }],
    });
    const trials = [
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "hook" }),
      makeTrial({ primitive: "memory" }),
      makeTrial({ primitive: "skill" }),
    ];
    const score = scoreCase(c, trials);
    // script + hook = 2/4 acceptable
    expect(score.acceptableRate).toBeCloseTo(2 / 4);
    // primary (script) = 1/4
    expect(score.primaryRate).toBeCloseTo(1 / 4);
  });

  it("computes mustRejectRate correctly", () => {
    const c = makeCase({ mustReject: ["skill", "agent"] });
    const trials = [
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "skill" }),   // reject hit
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "agent" }),   // reject hit
    ];
    const score = scoreCase(c, trials);
    expect(score.mustRejectRate).toBeCloseTo(2 / 4);
    expect(score.rejectedHits).toEqual(expect.arrayContaining(["skill", "agent"]));
    expect(score.rejectedHits).toHaveLength(2);
  });

  it("computes scopeMatchRate only among primary hits", () => {
    const c = makeCase({ expected: { primitive: "skill", scope: "user" } });
    const trials = [
      // primary hit, correct scope
      makeTrial({ primitive: "skill", scope: "user" }),
      // primary hit, wrong scope
      makeTrial({ primitive: "skill", scope: "project" }),
      // not primary, correct scope — should NOT count
      makeTrial({ primitive: "hook", scope: "user" }),
    ];
    const score = scoreCase(c, trials);
    // 2 primary hits, 1 of which has matching scope
    expect(score.primaryRate).toBeCloseTo(2 / 3);
    expect(score.scopeMatchRate).toBeCloseTo(1 / 2);
  });

  it("scopeMatchRate is 0 when there are no primary hits", () => {
    const c = makeCase({ expected: { primitive: "skill", scope: "user" } });
    const trials = [makeTrial({ primitive: "hook" })];
    const score = scoreCase(c, trials);
    expect(score.scopeMatchRate).toBe(0);
  });

  it("returns zero rates and pass=false for empty trials", () => {
    const c = makeCase();
    const score = scoreCase(c, []);
    expect(score.primaryRate).toBe(0);
    expect(score.acceptableRate).toBe(0);
    expect(score.scopeMatchRate).toBe(0);
    expect(score.mustRejectRate).toBe(0);
    expect(score.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreCase — pass/fail logic
// ---------------------------------------------------------------------------

describe("scoreCase — pass/fail logic", () => {
  it("passes when primaryRate >= threshold and mustRejectRate === 0", () => {
    const c = makeCase({ mustReject: ["hook"] });
    // 3/4 = 0.75 >= 0.6, no reject hits
    const trials = Array.from({ length: 4 }, (_, i) =>
      makeTrial({ primitive: i < 3 ? "script" : "memory" }),
    );
    const score = scoreCase(c, trials, { threshold: 0.6 });
    expect(score.pass).toBe(true);
  });

  it("fails when primaryRate < threshold even with no reject hits", () => {
    const c = makeCase();
    // 1/4 = 0.25 < 0.6
    const trials = [
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "hook" }),
      makeTrial({ primitive: "hook" }),
      makeTrial({ primitive: "hook" }),
    ];
    const score = scoreCase(c, trials, { threshold: 0.6 });
    expect(score.pass).toBe(false);
  });

  it("fails when a mustReject primitive is hit even though primaryRate >= threshold (hard-fail)", () => {
    const c = makeCase({ mustReject: ["hook"] });
    // primaryRate = 4/4 = 1.0, but 1 trial hit a rejected primitive
    // We test with 5 trials: 4 correct + 1 rejected
    const trials = [
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "hook" }), // rejected!
    ];
    const score = scoreCase(c, trials, { threshold: 0.6 });
    expect(score.primaryRate).toBeCloseTo(4 / 5); // >= 0.6
    expect(score.mustRejectRate).toBeCloseTo(1 / 5); // > 0 (rejectTolerance default 0)
    expect(score.pass).toBe(false);
  });

  it("does NOT fail when mustRejectRate is within reject-tolerance", () => {
    const c = makeCase({ mustReject: ["hook"] });
    // 1/5 = 0.2 mustRejectRate, tolerance = 0.25 → should pass
    const trials = [
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "script" }),
      makeTrial({ primitive: "hook" }),
    ];
    const score = scoreCase(c, trials, { threshold: 0.6, rejectTolerance: 0.25 });
    expect(score.pass).toBe(true);
  });

  it("a case rescued only by acceptableAlternatives still fails primary", () => {
    // acceptableRate is high, but primaryRate is low → still fails the primary gate
    const c = makeCase({
      expected: { primitive: "script", scope: "project" },
      acceptableAlternatives: [{ primitive: "hook", scope: "project" }],
    });
    // Only 1/5 correct on primary, but 4/5 on acceptable
    const trials = [
      makeTrial({ primitive: "script" }),  // primary hit
      makeTrial({ primitive: "hook" }),    // acceptable
      makeTrial({ primitive: "hook" }),    // acceptable
      makeTrial({ primitive: "hook" }),    // acceptable
      makeTrial({ primitive: "memory" }), // neither
    ];
    const score = scoreCase(c, trials, { threshold: 0.6 });
    expect(score.primaryRate).toBeCloseTo(1 / 5);     // 0.2 < 0.6
    expect(score.acceptableRate).toBeCloseTo(4 / 5);  // 0.8 (high)
    expect(score.pass).toBe(false);                   // fails because primary < threshold
  });
});

// ---------------------------------------------------------------------------
// scoreAll — aggregate + per-tag + per-tier
// ---------------------------------------------------------------------------

describe("scoreAll", () => {
  it("computes correct overall accuracy across multiple cases", () => {
    const evalCases = [
      makeCase({ id: "case-1", expected: { primitive: "script", scope: "project" }, tags: ["t1"] }),
      makeCase({ id: "case-2", expected: { primitive: "skill", scope: "user" }, tags: ["t1"] }),
    ];
    const results = [
      // case-1: 3/3 = 1.0 primary → passes
      { id: "case-1", primitive: "script", scope: "project" },
      { id: "case-1", primitive: "script", scope: "project" },
      { id: "case-1", primitive: "script", scope: "project" },
      // case-2: 0/3 = 0 primary → fails
      { id: "case-2", primitive: "hook", scope: "user" },
      { id: "case-2", primitive: "hook", scope: "user" },
      { id: "case-2", primitive: "hook", scope: "user" },
    ];
    const { report } = scoreAll(evalCases, results, { threshold: 0.6 });
    expect(report.overall.passed).toBe(1);
    expect(report.overall.total).toBe(2);
    expect(report.overall.accuracy).toBeCloseTo(0.5);
  });

  it("computes per-tag accuracy correctly", () => {
    const evalCases = [
      makeCase({ id: "c1", expected: { primitive: "script", scope: "project" }, tags: ["slow", "fast"] }),
      makeCase({ id: "c2", expected: { primitive: "skill", scope: "user" }, tags: ["fast"] }),
    ];
    const results = [
      // c1 passes (3/3 = 1.0)
      { id: "c1", primitive: "script" },
      { id: "c1", primitive: "script" },
      { id: "c1", primitive: "script" },
      // c2 fails (0/3)
      { id: "c2", primitive: "hook" },
      { id: "c2", primitive: "hook" },
      { id: "c2", primitive: "hook" },
    ];
    const { report } = scoreAll(evalCases, results);
    // "slow" only has c1 (passes) → 100%
    expect(report.perTag["slow"].accuracy).toBeCloseTo(1);
    expect(report.perTag["slow"].passed).toBe(1);
    // "fast" has c1+c2, only c1 passes → 50%
    expect(report.perTag["fast"].accuracy).toBeCloseTo(0.5);
    expect(report.perTag["fast"].passed).toBe(1);
    expect(report.perTag["fast"].total).toBe(2);
  });

  it("computes per-tier breakdown and clarity-floor correctly", () => {
    const evalCases = [
      makeCase({ id: "c1", expected: { primitive: "script", scope: "project" }, tags: [] }),
      makeCase({ id: "c2", expected: { primitive: "skill", scope: "user" }, tags: [] }),
    ];
    // haiku: both cases pass
    // opus: c2 fails
    const results = [
      { id: "c1", primitive: "script", tier: "haiku" },
      { id: "c1", primitive: "script", tier: "haiku" },
      { id: "c1", primitive: "script", tier: "haiku" },
      { id: "c2", primitive: "skill", tier: "haiku" },
      { id: "c2", primitive: "skill", tier: "haiku" },
      { id: "c2", primitive: "skill", tier: "haiku" },
      { id: "c1", primitive: "script", tier: "opus" },
      { id: "c1", primitive: "script", tier: "opus" },
      { id: "c1", primitive: "script", tier: "opus" },
      { id: "c2", primitive: "hook", tier: "opus" },  // wrong → fails
      { id: "c2", primitive: "hook", tier: "opus" },
      { id: "c2", primitive: "hook", tier: "opus" },
    ];
    const { report } = scoreAll(evalCases, results, { threshold: 0.6 });

    // haiku: both pass → accuracy 1.0
    expect(report.perTier["haiku"].passed).toBe(2);
    expect(report.perTier["haiku"].accuracy).toBeCloseTo(1);

    // opus: only c1 passes → accuracy 0.5
    expect(report.perTier["opus"].passed).toBe(1);
    expect(report.perTier["opus"].accuracy).toBeCloseTo(0.5);

    // Clarity floor = haiku (cheapest tier where ALL cases pass)
    expect(report.clarityFloor).toBe("haiku");
  });

  it("clarity floor is null when no tier has all cases passing", () => {
    const evalCases = [
      makeCase({ id: "c1", expected: { primitive: "script", scope: "project" }, tags: [] }),
      makeCase({ id: "c2", expected: { primitive: "skill", scope: "user" }, tags: [] }),
    ];
    const results = [
      // haiku: c1 passes, c2 fails
      { id: "c1", primitive: "script", tier: "haiku" },
      { id: "c2", primitive: "hook", tier: "haiku" },
      // sonnet: c1 fails, c2 passes
      { id: "c1", primitive: "memory", tier: "sonnet" },
      { id: "c2", primitive: "skill", tier: "sonnet" },
    ];
    const { report } = scoreAll(evalCases, results, { threshold: 0.6 });
    expect(report.clarityFloor).toBeNull();
  });

  it("warns about unknown result id and ignores the record", () => {
    const evalCases = [makeCase({ id: "known-case", tags: [] })];
    const results = [
      { id: "known-case", primitive: "script" },
      { id: "unknown-id-xyz", primitive: "script" },
    ];
    const { report, warnings } = scoreAll(evalCases, results);
    expect(warnings.some((w) => w.includes("unknown-id-xyz"))).toBe(true);
    // Scorer ignores the unknown record — only known-case is scored
    expect(report.overall.total).toBe(1);
  });

  it("warns about unknown primitive and treats it as non-match", () => {
    const evalCases = [makeCase({ id: "c1", expected: { primitive: "script", scope: "project" }, tags: [] })];
    const results = [
      { id: "c1", primitive: "not-a-primitive" },
      { id: "c1", primitive: "script" },
    ];
    const { report, warnings } = scoreAll(evalCases, results);
    expect(warnings.some((w) => w.includes("not-a-primitive"))).toBe(true);
    // 1/2 primary hits = 0.5 < 0.6 threshold → fails
    const caseResult = report.cases.find((c) => c.id === "c1");
    expect(caseResult?.primaryRate).toBeCloseTo(0.5);
  });

  it("applies tag filter to restrict scored cases", () => {
    const evalCases = [
      makeCase({ id: "c1", tags: ["slow"] }),
      makeCase({ id: "c2", tags: ["fast"] }),
    ];
    const results = [
      { id: "c1", primitive: "script" },
      { id: "c2", primitive: "script" },
    ];
    const { report } = scoreAll(evalCases, results, { tagFilter: "slow" });
    // Only c1 should be scored
    expect(report.overall.total).toBe(1);
    expect(report.cases.map((c) => c.id)).toEqual(["c1"]);
  });

  it("assigns 0 trials and fail to a case with no results", () => {
    const evalCases = [makeCase({ id: "no-results", tags: [] })];
    const results = [];
    const { report } = scoreAll(evalCases, results);
    expect(report.overall.total).toBe(1);
    expect(report.overall.passed).toBe(0);
    expect(report.cases[0].primaryRate).toBe(0);
    expect(report.cases[0].pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// splitStratified
// ---------------------------------------------------------------------------

describe("splitStratified", () => {
  /** Build a synthetic eval set with a known primitive distribution. */
  function makeEvalSet() {
    const cases = [];
    for (let i = 0; i < 5; i++) {
      cases.push(makeCase({ id: `script-${i}`, expected: { primitive: "script" }, tags: [] }));
    }
    for (let i = 0; i < 4; i++) {
      cases.push(makeCase({ id: `skill-${i}`, expected: { primitive: "skill" }, tags: [] }));
    }
    for (let i = 0; i < 3; i++) {
      cases.push(makeCase({ id: `hook-${i}`, expected: { primitive: "hook" }, tags: [] }));
    }
    return cases;
  }

  it("is deterministic — same seed and ratio produce identical partitions", () => {
    const cases = makeEvalSet();
    const a = splitStratified(cases, { ratio: 0.6, seed: 42 });
    const b = splitStratified(cases, { ratio: 0.6, seed: 42 });
    expect(a.train).toEqual(b.train);
    expect(a.test).toEqual(b.test);
  });

  it("different seeds produce different partitions", () => {
    const cases = makeEvalSet();
    const a = splitStratified(cases, { ratio: 0.6, seed: 1 });
    const b = splitStratified(cases, { ratio: 0.6, seed: 2 });
    // With enough cases it's extremely unlikely seeds 1 and 2 produce the same split
    const aSorted = [...a.train].sort();
    const bSorted = [...b.train].sort();
    expect(aSorted).not.toEqual(bSorted);
  });

  it("train + test covers all case ids exactly once", () => {
    const cases = makeEvalSet();
    const { train, test } = splitStratified(cases, { ratio: 0.6, seed: 1 });
    const all = [...train, ...test].sort();
    const expected = cases.map((c) => c.id).sort();
    expect(all).toEqual(expected);
    // No duplicates
    expect(new Set(all).size).toBe(all.length);
  });

  it("is stratified — each primitive is split approximately to ratio", () => {
    const cases = makeEvalSet();
    const { train } = splitStratified(cases, { ratio: 0.6, seed: 1 });
    const trainSet = new Set(train);

    // script: 5 cases → Math.round(5 * 0.6) = 3 in train
    const scriptInTrain = cases.filter((c) => c.expected.primitive === "script" && trainSet.has(c.id));
    expect(scriptInTrain).toHaveLength(3);

    // skill: 4 cases → Math.round(4 * 0.6) = 2 in train
    const skillInTrain = cases.filter((c) => c.expected.primitive === "skill" && trainSet.has(c.id));
    expect(skillInTrain).toHaveLength(2);

    // hook: 3 cases → Math.round(3 * 0.6) = 2 in train
    const hookInTrain = cases.filter((c) => c.expected.primitive === "hook" && trainSet.has(c.id));
    expect(hookInTrain).toHaveLength(2);
  });

  it("handles an empty eval set", () => {
    const { train, test } = splitStratified([], { ratio: 0.6, seed: 1 });
    expect(train).toEqual([]);
    expect(test).toEqual([]);
  });

  it("uses default ratio=0.6 and seed=1 when not specified", () => {
    const cases = makeEvalSet();
    const explicit = splitStratified(cases, { ratio: 0.6, seed: 1 });
    const defaults = splitStratified(cases);
    expect(defaults.train).toEqual(explicit.train);
    expect(defaults.test).toEqual(explicit.test);
  });
});

// ---------------------------------------------------------------------------
// Integration: score against real routing-evals.json
// ---------------------------------------------------------------------------

describe("integration — real eval set", () => {
  it("loads routing-evals.json without error", () => {
    const evalsPath = path.join(__dirname, "..", "evals", "routing-evals.json");
    const cases = loadJson(evalsPath);
    expect(Array.isArray(cases)).toBe(true);
    expect(/** @type {unknown[]} */ (cases).length).toBeGreaterThan(0);
  });

  it("splitStratified on real eval set is deterministic", () => {
    const evalsPath = path.join(__dirname, "..", "evals", "routing-evals.json");
    const evalCases = /** @type {import('../evals/score.mjs').EvalCase[]} */ (loadJson(evalsPath));
    const a = splitStratified(evalCases, { ratio: 0.6, seed: 1 });
    const b = splitStratified(evalCases, { ratio: 0.6, seed: 1 });
    expect(a.train).toEqual(b.train);
    expect(a.test).toEqual(b.test);
  });

  it("scoreAll on perfect results gives accuracy 1.0", () => {
    const evalsPath = path.join(__dirname, "..", "evals", "routing-evals.json");
    const evalCases = /** @type {import('../evals/score.mjs').EvalCase[]} */ (loadJson(evalsPath));
    // Build a perfect results set: 3 trials per case, all correct
    const results = evalCases.flatMap((c) =>
      Array.from({ length: 3 }, () => ({
        id: c.id,
        primitive: c.expected.primitive,
        scope: c.expected.scope,
      })),
    );
    const { report } = scoreAll(evalCases, results, { threshold: 0.6 });
    expect(report.overall.accuracy).toBe(1);
    expect(report.overall.passed).toBe(evalCases.length);
  });

  it("scoreAll on all-wrong results gives accuracy 0", () => {
    const evalsPath = path.join(__dirname, "..", "evals", "routing-evals.json");
    const evalCases = /** @type {import('../evals/score.mjs').EvalCase[]} */ (loadJson(evalsPath));
    // Pick a wrong primitive for every case (use the first valid primitive that is NOT the expected one)
    const results = evalCases.flatMap((c) =>
      Array.from({ length: 3 }, () => ({
        id: c.id,
        // Use a wrong primitive that is not in mustReject just to avoid conflation
        primitive: VALID_PRIMITIVES.find((p) => p !== c.expected.primitive && !c.mustReject.includes(p)) ?? "memory",
        scope: c.expected.scope,
      })),
    );
    const { report } = scoreAll(evalCases, results, { threshold: 0.6 });
    expect(report.overall.accuracy).toBe(0);
    expect(report.overall.passed).toBe(0);
  });
});
