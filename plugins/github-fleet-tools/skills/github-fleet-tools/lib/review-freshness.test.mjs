/**
 * Unit tests for the review-freshness judgement: which paths are exempt, how a
 * per-file patch splits into hunks, how each hunk becomes a TypeSafe System One
 * request, and how the (asymmetric) policy turns answers into a verdict.
 *
 * Expected values come from the policy the gate documents (see SKILL.md,
 * "Review freshness") and from the TypeSafe request contract — never from
 * running the implementation.
 *
 * @see https://docs.typesafe.ai/api.md
 * @see https://docs.typesafe.ai/primitives/choice.md
 * @see https://docs.typesafe.ai/primitives/noul.md
 * @see https://git-scm.com/docs/diff-format
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_IGNORE_PATTERNS,
  THRESHOLDS,
  LIMITS,
  parseFreshnessConfig,
  narrowIgnorePatterns,
  FRESHNESS_CONFIG_PATH,
  isIgnoredPath,
  findCatchAllPattern,
  parseFilePatch,
  buildJudgementRequest,
  evaluateHunk,
  estimateTokens,
} from "./review-freshness.mjs";

describe("exempt (generated/mechanical) paths — only a human-reviewed committed config opens them", () => {
  it("exempts nothing by default", () => {
    expect(DEFAULT_IGNORE_PATTERNS).toEqual([]);
    expect(isIgnoredPath("pnpm-lock.yaml", DEFAULT_IGNORE_PATTERNS)).toBe(false);
  });

  it("reads the committed config's ignorePaths", () => {
    expect(FRESHNESS_CONFIG_PATH).toBe(".github/gh-merge.json");
    const p = parseFreshnessConfig('{"ignorePaths": ["api-report/", "pnpm-lock.yaml"]}');
    expect(p).toEqual(["api-report/", "pnpm-lock.yaml"]);
  });

  it("matches directory, basename, and anchored patterns", () => {
    const p = ["api-report/", "docs/api/", "pnpm-lock.yaml", "src/**/*.gen.ts"];
    expect(isIgnoredPath("api-report/core.api.md", p)).toBe(true);
    expect(isIgnoredPath("packages/core/api-report/core.api.md", p)).toBe(true);
    expect(isIgnoredPath("docs/api/core.md", p)).toBe(true);
    expect(isIgnoredPath("packages/x/pnpm-lock.yaml", p)).toBe(true);
    expect(isIgnoredPath("src/a/b/c.gen.ts", p)).toBe(true);
    expect(isIgnoredPath("src/c.gen.ts", p)).toBe(true);
    // Directory patterns match whole path segments only; anchored globs stay anchored.
    expect(isIgnoredPath("my-api-report/x.md", p)).toBe(false);
    expect(isIgnoredPath("src/docs/apiary.ts", p)).toBe(false);
    expect(isIgnoredPath("lib/src/c.gen.ts", p)).toBe(false);
    expect(isIgnoredPath("src/c.ts", p)).toBe(false);
  });

  describe("an invalid config fails closed", () => {
    for (const [label, text] of [
      ["not JSON", "{ignorePaths:"],
      ["not an object", '["api-report/"]'],
      ["ignorePaths not an array", '{"ignorePaths": "api-report/"}'],
      ["a non-string entry", '{"ignorePaths": ["api-report/", 3]}'],
      ["an empty entry", '{"ignorePaths": [" "]}'],
      ["an unknown key", '{"ignorePaths": [], "ignore": ["x/"]}'],
      ["a catch-all pattern", '{"ignorePaths": ["**"]}'],
    ]) {
      it(label, () => {
        expect(() => parseFreshnessConfig(text)).toThrow(/gh-merge\.json/);
      });
    }
  });

  it("an empty config object exempts nothing", () => {
    expect(parseFreshnessConfig("{}")).toEqual([]);
  });
});

describe("narrowIgnorePatterns — the environment can only remove exemptions", () => {
  const CONFIG = ["api-report/", "pnpm-lock.yaml"];

  it("unset or blank keeps the committed list", () => {
    expect(narrowIgnorePatterns(CONFIG, undefined)).toEqual(CONFIG);
    expect(narrowIgnorePatterns(CONFIG, "  ")).toEqual(CONFIG);
  });

  it("keeps only committed patterns the environment also names", () => {
    expect(narrowIgnorePatterns(CONFIG, "api-report/")).toEqual(["api-report/"]);
  });

  it("never adds a pattern the committed config lacks", () => {
    expect(narrowIgnorePatterns(CONFIG, "pnpm-lock.yaml, src/, **")).toEqual(["pnpm-lock.yaml"]);
    expect(narrowIgnorePatterns([], "api-report/")).toEqual([]);
  });

  it("a value naming nothing committed removes every exemption", () => {
    expect(narrowIgnorePatterns(CONFIG, "none")).toEqual([]);
  });
});

describe("findCatchAllPattern — exemptions name generated paths, they cannot switch the guard off", () => {
  it("flags patterns that would exempt ordinary source everywhere", () => {
    for (const p of ["*", "**", "**/*", "*/", "**/"]) {
      expect(findCatchAllPattern(["api-report/", p])).toBe(p);
    }
  });

  it("accepts ordinary narrow patterns", () => {
    expect(findCatchAllPattern(["api-report/", "docs/api/", ".changeset/", "pnpm-lock.yaml"])).toBeUndefined();
    expect(findCatchAllPattern(["generated/", "*.snap", "src/**/*.gen.ts"])).toBeUndefined();
  });
});

describe("parseFilePatch", () => {
  const PATCH = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,3 @@ function first() {",
    " keep",
    "-old one",
    "+new one",
    "@@ -20,2 +20,3 @@",
    " ctx",
    "+added",
    "",
  ].join("\n");

  it("splits a file's patch into one entry per @@ hunk, header included", () => {
    const { binary, hunks } = parseFilePatch(PATCH);
    expect(binary).toBe(false);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].header).toBe("@@ -1,3 +1,3 @@ function first() {");
    expect(hunks[0].patch).toBe(
      ["@@ -1,3 +1,3 @@ function first() {", " keep", "-old one", "+new one"].join("\n"),
    );
    expect(hunks[1].patch).toBe(["@@ -20,2 +20,3 @@", " ctx", "+added"].join("\n"));
  });

  it("flags binary changes (they have no reviewable text)", () => {
    const bin = [
      "diff --git a/img.png b/img.png",
      "index 1111111..2222222 100644",
      "Binary files a/img.png and b/img.png differ",
      "",
    ].join("\n");
    const { binary, hunks } = parseFilePatch(bin);
    expect(binary).toBe(true);
    expect(hunks).toEqual([]);
  });

  it("returns no hunks for a header-only change such as a pure rename", () => {
    const rename = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to new.ts",
      "",
    ].join("\n");
    expect(parseFilePatch(rename)).toEqual({ binary: false, hunks: [] });
  });
});

/** A small, realistic thread set used by the request/policy tests. */
const THREADS = [
  {
    id: "thread_1",
    path: "src/a.ts",
    line: 2,
    resolved: true,
    outdated: true,
    comments: [
      { author: "copilot-pull-request-reviewer", body: "`old one` is off by one; use `new one`." },
      { author: "mike-north", body: "Fixed in the next commit." },
    ],
  },
  {
    id: "thread_2",
    path: "README.md",
    line: 10,
    resolved: false,
    outdated: false,
    comments: [{ author: "copilot-pull-request-reviewer", body: "Typo: 'teh'." }],
  },
];

const HUNK = {
  file: "src/a.ts",
  header: "@@ -1,3 +1,3 @@",
  patch: "@@ -1,3 +1,3 @@\n keep\n-old one\n+new one",
};

describe("buildJudgementRequest", () => {
  const req = buildJudgementRequest(HUNK, THREADS);

  it("puts the hunk and the review threads in named state fields", () => {
    expect(req.state.change).toEqual({ file: "src/a.ts", patch: HUNK.patch });
    expect(req.state.review_threads).toHaveLength(2);
    expect(req.state.review_threads[0]).toMatchObject({
      thread: "thread_1",
      file: "src/a.ts",
      line: 2,
      resolved: true,
      comments: THREADS[0].comments,
    });
  });

  it("asks a Choice over every thread plus 'mechanical' and 'new_change'", () => {
    const q = req.questions.addresses;
    expect(q.type).toBe("choice");
    expect(Object.keys(q.criteria).sort()).toEqual(
      ["mechanical", "new_change", "thread_1", "thread_2"].sort(),
    );
    // Question IDs are not sent to the model, so the instructions must carry the
    // full meaning and point at the state they judge.
    expect(JSON.stringify(q.instructions)).toContain("`change`");
    expect(JSON.stringify(q.instructions)).toContain("`review_threads`");
  });

  it("asks a Noul whose 'yes' means the change goes beyond the feedback", () => {
    const q = req.questions.beyond;
    expect(q.type).toBe("noul");
    expect(q.criteria).toHaveProperty("true");
    expect(q.criteria).toHaveProperty("false");
  });

  it("asks an independent Noul whose 'yes' means the change is purely mechanical", () => {
    const q = req.questions.mechanical;
    expect(q.type).toBe("noul");
    expect(JSON.stringify(q.instructions)).toContain("`change`");
    expect(q.criteria).toHaveProperty("true");
    expect(q.criteria).toHaveProperty("false");
  });

  it("omits other_changes when the hunk was pushed alone", () => {
    expect(req.state).not.toHaveProperty("other_changes");
  });

  it("includes the push's other hunks as context when given", () => {
    const sib = [{ file: "README.md", patch: "@@ -1 +1 @@\n-teh\n+the" }];
    const r = buildJudgementRequest(HUNK, THREADS, sib);
    expect(r.state.other_changes).toEqual(sib);
    expect(JSON.stringify(r.questions.addresses.instructions)).toContain("`other_changes`");
  });

  it("with no review threads, still offers exactly 'mechanical' and 'new_change'", () => {
    const bare = buildJudgementRequest(HUNK, []);
    expect(Object.keys(bare.questions.addresses.criteria).sort()).toEqual([
      "mechanical",
      "new_change",
    ]);
    expect(bare.state.review_threads).toEqual([]);
  });

  it("truncates very long thread comments so state stays within budget", () => {
    const long = "x".repeat(LIMITS.maxCommentChars + 500);
    const r = buildJudgementRequest(HUNK, [
      { ...THREADS[1], comments: [{ author: "copilot", body: long }] },
    ]);
    const body = r.state.review_threads[0].comments[0].body;
    expect(body.length).toBeLessThan(long.length);
    expect(body).toMatch(/truncated/);
  });
});

describe("estimateTokens", () => {
  it("is conservative (at least one token per three characters)", () => {
    expect(estimateTokens("a".repeat(300))).toBeGreaterThanOrEqual(100);
  });
});

/** Build Choice/Noul answers in the HTTP API's answer shape. */
function answers({ choice, probabilities, confidence, beyond, mechanical = 0.05 }) {
  return {
    addresses: { type: "choice", choice, probabilities, confidence },
    beyond: { type: "noul", noul: beyond },
    ...(mechanical === undefined ? {} : { mechanical: { type: "noul", noul: mechanical } }),
  };
}

describe("evaluateHunk — the asymmetric policy", () => {
  it("covered: confidently maps to a thread and stays in scope", () => {
    const v = evaluateHunk(
      answers({
        choice: "thread_1",
        probabilities: { thread_1: 0.9, thread_2: 0.02, mechanical: 0.03, new_change: 0.05 },
        confidence: 0.85,
        beyond: 0.1,
      }),
    );
    expect(v.verdict).toBe("covered");
    expect(v.reasons).toEqual([]);
    expect(v.addresses).toBe("thread_1");
  });

  it("covered: confidently mechanical on both independent signals, whatever the scope Noul says", () => {
    const v = evaluateHunk(
      answers({
        choice: "mechanical",
        probabilities: { mechanical: 0.97, new_change: 0.03 },
        confidence: THRESHOLDS.minMechanicalConfidence,
        beyond: 0.7,
        mechanical: THRESHOLDS.minMechanicalNoul,
      }),
    );
    expect(v.verdict).toBe("covered");
    expect(v.mechanical).toBe(THRESHOLDS.minMechanicalNoul);
  });

  it("needs review: labelled mechanical, but not confidently enough", () => {
    const v = evaluateHunk(
      answers({
        choice: "mechanical",
        probabilities: { mechanical: 0.86, new_change: 0.14 },
        confidence: THRESHOLDS.minMechanicalConfidence - 0.01,
        beyond: 0.1,
        mechanical: 0.95,
      }),
    );
    expect(v.verdict).toBe("needs_review");
    expect(v.reasons.join(" ")).toMatch(/not confidently mechanical/);
  });

  it("needs review: labelled mechanical, but the independent Noul says it changes meaning", () => {
    const v = evaluateHunk(
      answers({
        choice: "mechanical",
        probabilities: { mechanical: 0.97, new_change: 0.03 },
        confidence: 0.95,
        beyond: 0.1,
        mechanical: THRESHOLDS.minMechanicalNoul - 0.01,
      }),
    );
    expect(v.verdict).toBe("needs_review");
    expect(v.reasons.join(" ")).toMatch(/behavior or meaning/);
  });

  it("needs review: labelled mechanical with no mechanical judgement at all", () => {
    const v = evaluateHunk(
      answers({
        choice: "mechanical",
        probabilities: { mechanical: 0.97, new_change: 0.03 },
        confidence: 0.95,
        beyond: 0.1,
        mechanical: undefined,
      }),
    );
    expect(v.verdict).toBe("needs_review");
  });

  it("needs review: classified as a new change", () => {
    const v = evaluateHunk(
      answers({
        choice: "new_change",
        probabilities: { thread_1: 0.1, mechanical: 0.05, new_change: 0.85 },
        confidence: 0.8,
        beyond: 0.9,
      }),
    );
    expect(v.verdict).toBe("needs_review");
    expect(v.reasons.join(" ")).toMatch(/new change/);
  });

  it("needs review: scope creep at or above the threshold even when mapped to a thread", () => {
    const v = evaluateHunk(
      answers({
        choice: "thread_1",
        probabilities: { thread_1: 0.9, mechanical: 0.05, new_change: 0.05 },
        confidence: 0.85,
        beyond: THRESHOLDS.maxBeyond,
      }),
    );
    expect(v.verdict).toBe("needs_review");
    expect(v.reasons.join(" ")).toMatch(/beyond/);
  });

  it("needs review: low confidence in the mapping", () => {
    const v = evaluateHunk(
      answers({
        choice: "thread_1",
        probabilities: { thread_1: 0.45, thread_2: 0.4, mechanical: 0.1, new_change: 0.05 },
        confidence: THRESHOLDS.minConfidence - 0.01,
        beyond: 0.1,
      }),
    );
    expect(v.verdict).toBe("needs_review");
    expect(v.reasons.join(" ")).toMatch(/confidence/);
  });

  it("needs review: meaningful probability of being a new change, even if not the top pick", () => {
    const v = evaluateHunk(
      answers({
        choice: "thread_1",
        probabilities: {
          thread_1: 1 - THRESHOLDS.maxNewChangeProbability,
          new_change: THRESHOLDS.maxNewChangeProbability,
        },
        confidence: 0.9,
        beyond: 0.1,
      }),
    );
    expect(v.verdict).toBe("needs_review");
  });

  it("needs review: a missing new_change probability is treated as unknown, not zero", () => {
    const v = evaluateHunk(
      answers({ choice: "thread_1", probabilities: { thread_1: 1 }, confidence: 0.99, beyond: 0.1 }),
    );
    expect(v.verdict).toBe("needs_review");
  });
});
