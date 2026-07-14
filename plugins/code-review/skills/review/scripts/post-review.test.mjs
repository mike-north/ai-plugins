/**
 * Tests for post-review.mjs.
 *
 * Pure business logic (fence/cluster construction, per-finding posting plans,
 * mutation-plan assembly, marker round-tripping) is unit-tested directly with
 * hand-built SARIF fragments. The CLI is exercised end-to-end (dry-run, head
 * drift, foreign pending review, batch success, fallback/resume with a
 * partial failure) against a stub `gh` executable driven by an ordered,
 * per-invocation-consuming rule list — no network, no real GitHub auth.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureRepo, removeDir } from "./test-support/git-fixture.mjs";
import {
  applyDemotions,
  buildFileIndex,
  buildFixClusters,
  buildMarker,
  buildMutationPlan,
  buildSuggestionFence,
  parseMarker,
  planForResult,
  resolveWorktree,
  runFallback,
  toGithubThreadInput,
} from "./post-review.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "post-review.mjs");

function lineResult({ ruleId = "rule", level = "error", message = "message", file, startLine, endLine, confidence = "high", scope = "line", findingId, extraProps = {}, fixes }) {
  return {
    ruleId,
    level,
    message: { text: message },
    properties: { findingId: findingId ?? `${ruleId}-1`, confidence, reviewer: "typescript", scope, ...extraProps },
    ...(scope === "pr" ? {} : { locations: [{ physicalLocation: { artifactLocation: { uri: file }, ...(startLine != null ? { region: { startLine, endLine: endLine ?? startLine } } : {}) } }] }),
    ...(fixes ? { fixes } : {}),
  };
}

function fixWithReplacements(replacements, { description = "fix it" } = {}) {
  const byFile = new Map();
  for (const r of replacements) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push({ deletedRegion: { startLine: r.startLine, endLine: r.endLine }, insertedContent: { text: r.text } });
  }
  return {
    description: { text: description },
    artifactChanges: [...byFile].map(([file, reps]) => ({ artifactLocation: { uri: file }, replacements: reps })),
  };
}

describe("buildMarker / parseMarker", () => {
  it("round-trips", () => {
    const body = `message\n\n${buildMarker("typescript-3", 2, 4)}`;
    expect(parseMarker(body)).toEqual({ findingId: "typescript-3", part: 2, total: 4 });
  });
  it("returns null when there is no marker (negative)", () => {
    expect(parseMarker("just a message, no marker")).toBeNull();
    expect(parseMarker(undefined)).toBeNull();
  });
});

describe("buildFileIndex", () => {
  it("builds ranges from each file's patch, keyed by filename", () => {
    const files = [
      { filename: "a.ts", status: "modified", patch: "@@ -1,2 +1,3 @@\n line\n+added\n line" },
      { filename: "b.ts", status: "added", patch: undefined },
    ];
    const index = buildFileIndex(files);
    expect(index.get("a.ts").ranges).toEqual([{ startLine: 1, endLine: 3 }]);
    expect(index.get("b.ts").ranges).toEqual([]);
    expect(index.get("b.ts").status).toBe("added");
  });

  it("returns an empty index for no files (negative/edge)", () => {
    expect(buildFileIndex([]).size).toBe(0);
    expect(buildFileIndex(undefined).size).toBe(0);
  });
});

describe("buildSuggestionFence", () => {
  it("uses a 3-backtick fence for ordinary content", () => {
    expect(buildSuggestionFence("const x = 1;")).toBe("```suggestion\nconst x = 1;\n```");
  });

  it("widens the fence beyond the longest backtick run in the content", () => {
    const content = "here is ```js code``` inline";
    const fence = buildSuggestionFence(content);
    expect(fence.startsWith("````suggestion\n")).toBe(true); // 4 backticks: longest run (3) + 1
    expect(fence.endsWith("````")).toBe(true);
  });

  it("produces a valid empty fence for a pure deletion (negative: no inserted content)", () => {
    expect(buildSuggestionFence("")).toBe("```suggestion\n```");
  });
});

describe("buildFixClusters", () => {
  const headLines = { "a.ts": ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"] };
  const getHeadLines = (file) => headLines[file];

  it("keeps a single replacement as one cluster", () => {
    const fix = fixWithReplacements([{ file: "a.ts", startLine: 2, endLine: 2, text: "l2 fixed" }]);
    const { oversized, clusters } = buildFixClusters(fix, { getHeadLines });
    expect(oversized).toBe(false);
    expect(clusters).toEqual([{ path: "a.ts", startLine: 2, endLine: 2, insertedLines: ["l2 fixed"] }]);
  });

  it("coalesces two replacements separated by <= 2 unchanged lines, filling the gap with HEAD content", () => {
    const fix = fixWithReplacements([
      { file: "a.ts", startLine: 1, endLine: 1, text: "l1 fixed" },
      { file: "a.ts", startLine: 3, endLine: 3, text: "l3 fixed" }, // gap: line 2 only (1 line, <= 2)
    ]);
    const { oversized, clusters } = buildFixClusters(fix, { getHeadLines });
    expect(oversized).toBe(false);
    expect(clusters).toEqual([{ path: "a.ts", startLine: 1, endLine: 3, insertedLines: ["l1 fixed", "l2", "l3 fixed"] }]);
  });

  it("does NOT coalesce replacements separated by more than 2 unchanged lines (negative)", () => {
    const fix = fixWithReplacements([
      { file: "a.ts", startLine: 1, endLine: 1, text: "l1 fixed" },
      { file: "a.ts", startLine: 5, endLine: 5, text: "l5 fixed" }, // gap: lines 2-4 (3 lines, > 2)
    ]);
    const { clusters } = buildFixClusters(fix, { getHeadLines });
    expect(clusters).toHaveLength(2);
  });

  it("never coalesces across different files", () => {
    const fix = fixWithReplacements([
      { file: "a.ts", startLine: 1, endLine: 1, text: "x" },
      { file: "b.ts", startLine: 1, endLine: 1, text: "y" },
    ]);
    const { clusters } = buildFixClusters(fix, { getHeadLines: () => ["only"] });
    expect(clusters).toHaveLength(2);
  });

  it("flags oversized when there are more than 3 clusters (negative)", () => {
    const fix = fixWithReplacements([
      { file: "a.ts", startLine: 1, endLine: 1, text: "a" },
      { file: "a.ts", startLine: 3, endLine: 3, text: "b" }, // gap 1 -> merges with prev? no: gap between line1..line3 is line2 only -> merges
    ]);
    // Build 4 genuinely separate (far-apart) clusters instead, to isolate the ">3 clusters" condition:
    const farApart = fixWithReplacements([
      { file: "a.ts", startLine: 1, endLine: 1, text: "a" },
      { file: "a.ts", startLine: 10, endLine: 10, text: "b" },
      { file: "a.ts", startLine: 20, endLine: 20, text: "c" },
      { file: "a.ts", startLine: 30, endLine: 30, text: "d" },
    ]);
    const bigHeadLines = Array.from({ length: 40 }, (_, i) => `l${i + 1}`);
    const { oversized, clusters } = buildFixClusters(farApart, { getHeadLines: () => bigHeadLines });
    expect(clusters).toHaveLength(4);
    expect(oversized).toBe(true);
  });

  it("flags oversized when a single replacement exceeds 100 lines (negative)", () => {
    const fix = fixWithReplacements([{ file: "a.ts", startLine: 1, endLine: 101, text: "x" }]);
    const { oversized } = buildFixClusters(fix, { getHeadLines });
    expect(oversized).toBe(true);
  });

  it("flags oversized when the fix includes a whole-file (add/rename/binary) change (negative)", () => {
    const fix = {
      description: { text: "d" },
      artifactChanges: [
        { artifactLocation: { uri: "new.ts" }, properties: { kind: "add" } },
        { artifactLocation: { uri: "a.ts" }, replacements: [{ deletedRegion: { startLine: 1, endLine: 1 }, insertedContent: { text: "x" } }] },
      ],
    };
    const { oversized } = buildFixClusters(fix, { getHeadLines });
    expect(oversized).toBe(true);
  });

  it("does not coalesce across a gap that intersects another finding's own fix range (finding B regression)", () => {
    // Without otherRangesByFile awareness, a fix's own gap-fill blindly reads
    // raw HEAD content for the gap — even when a DIFFERENT finding's own fix
    // already proposes a change inside that exact gap, producing stale
    // content in this fix's suggestion AND two overlapping suggestion threads
    // in the GitHub UI (this cluster's coalesced range vs. the other
    // finding's own range, both covering the same line).
    const tenLines = { "a.ts": Array.from({ length: 10 }, (_, i) => `l${i + 1}`) };
    const getHeadLines10 = (file) => tenLines[file];
    // This fix's own two replacements are 2 lines apart (lines 3 and 6) — within
    // COALESCE_GAP — but another finding's fix targets line 5, inside that gap.
    const fix = fixWithReplacements([
      { file: "a.ts", startLine: 3, endLine: 3, text: "A3" },
      { file: "a.ts", startLine: 6, endLine: 6, text: "A6" },
    ]);
    const otherRangesByFile = new Map([["a.ts", [{ startLine: 5, endLine: 5 }]]]);

    const { oversized, clusters } = buildFixClusters(fix, { getHeadLines: getHeadLines10, otherRangesByFile });
    expect(oversized).toBe(false);
    expect(clusters).toHaveLength(2); // split into two separate clusters, not coalesced into one
    expect(clusters[0]).toEqual({ path: "a.ts", startLine: 3, endLine: 3, insertedLines: ["A3"] });
    expect(clusters[1]).toEqual({ path: "a.ts", startLine: 6, endLine: 6, insertedLines: ["A6"] });
    // Neither cluster's range overlaps the other finding's line-5 range.
    for (const c of clusters) {
      expect(c.startLine <= 5 && c.endLine >= 5).toBe(false);
    }
  });

  it("still coalesces across a gap when no other finding's fix intersects it (negative: otherRangesByFile must not over-block)", () => {
    const tenLines = { "a.ts": Array.from({ length: 10 }, (_, i) => `l${i + 1}`) };
    const getHeadLines10 = (file) => tenLines[file];
    const fix = fixWithReplacements([
      { file: "a.ts", startLine: 3, endLine: 3, text: "A3" },
      { file: "a.ts", startLine: 6, endLine: 6, text: "A6" },
    ]);
    const otherRangesByFile = new Map([["a.ts", [{ startLine: 9, endLine: 9 }]]]); // well outside the gap
    const { clusters } = buildFixClusters(fix, { getHeadLines: getHeadLines10, otherRangesByFile });
    expect(clusters).toHaveLength(1); // coalesces exactly as before
    expect(clusters[0]).toEqual({ path: "a.ts", startLine: 3, endLine: 6, insertedLines: ["A3", "l4", "l5", "A6"] });
  });
});

describe("planForResult", () => {
  const fileIndex = buildFileIndex([{ filename: "a.ts", status: "modified", patch: "@@ -1,5 +1,5 @@\n l1\n l2\n l3\n l4\n l5" }]);
  const getHeadLines = () => ["l1", "l2", "l3", "l4", "l5"];

  it("builds a single message-only thread when there is no fix and the location is on the diff", () => {
    const result = lineResult({ file: "a.ts", startLine: 2, message: "off-by-one" });
    const plan = planForResult(result, { fileIndex, getHeadLines });
    expect(plan.kind).toBe("threads");
    expect(plan.threads).toHaveLength(1);
    expect(plan.threads[0]).toMatchObject({ path: "a.ts", line: 2, startLine: undefined });
    expect(plan.threads[0].body).toContain("off-by-one");
    expect(plan.threads[0].body).toContain(buildMarker("rule-1", 1, 1));
  });

  it("demotes a fixless finding whose location is not on the diff (negative)", () => {
    const result = lineResult({ file: "a.ts", startLine: 200, message: "out of range" });
    const plan = planForResult(result, { fileIndex, getHeadLines: () => Array.from({ length: 300 }, (_, i) => `l${i + 1}`) });
    expect(plan.kind).toBe("demoted");
    expect(plan.reason).toMatch(/not on the PR's current diff/);
  });

  it("builds a suggestion-fence thread for a small, clean, anchorable fix", () => {
    const result = lineResult({
      file: "a.ts",
      startLine: 2,
      message: "off-by-one",
      fixes: [fixWithReplacements([{ file: "a.ts", startLine: 2, endLine: 2, text: "l2 fixed" }])],
    });
    const plan = planForResult(result, { fileIndex, getHeadLines });
    expect(plan.kind).toBe("threads");
    expect(plan.threads[0].body).toContain("```suggestion\nl2 fixed\n```");
  });

  it("falls back to a single anchored diff-block comment when the fix is oversized but the primary location anchors", () => {
    const result = lineResult({
      file: "a.ts",
      startLine: 2,
      message: "messy fix",
      fixes: [fixWithReplacements([{ file: "a.ts", startLine: 1, endLine: 102, text: "x" }])], // >100 lines -> oversized
    });
    const plan = planForResult(result, { fileIndex, getHeadLines: () => Array.from({ length: 200 }, (_, i) => `l${i + 1}`) });
    expect(plan.kind).toBe("anchored-diff");
    expect(plan.thread.body).toContain("```diff");
    expect(plan.thread.line).toBe(2);
  });

  it("demotes entirely when the fix is oversized AND the primary location doesn't anchor (negative)", () => {
    const result = lineResult({
      file: "a.ts",
      startLine: 500,
      message: "messy and out of range",
      fixes: [fixWithReplacements([{ file: "a.ts", startLine: 1, endLine: 102, text: "x" }])],
    });
    const plan = planForResult(result, { fileIndex, getHeadLines: () => Array.from({ length: 600 }, (_, i) => `l${i + 1}`) });
    expect(plan.kind).toBe("demoted");
    expect(plan.reason).toMatch(/fix is not anchorable/);
  });

  it("omits startLine when the region is a single line, includes it for a range", () => {
    const single = lineResult({ file: "a.ts", startLine: 2, message: "m" });
    const range = lineResult({ file: "a.ts", startLine: 1, endLine: 3, message: "m" });
    expect(planForResult(single, { fileIndex, getHeadLines }).threads[0].startLine).toBeUndefined();
    expect(planForResult(range, { fileIndex, getHeadLines }).threads[0]).toMatchObject({ startLine: 1, line: 3 });
  });
});

describe("buildMutationPlan", () => {
  it("routes scope file|pr to designLevel, pre-demoted findings to demotions (pre:true), and everything else through planForResult", () => {
    const fileIndex = buildFileIndex([{ filename: "a.ts", status: "modified", patch: "@@ -1,3 +1,3 @@\n l1\n l2\n l3" }]);
    const getHeadLines = () => ["l1", "l2", "l3"];
    const log = {
      runs: [
        {
          results: [
            lineResult({ file: "a.ts", startLine: 1, message: "inline finding", findingId: "a" }),
            lineResult({ scope: "file", file: "a.ts", message: "design finding", findingId: "b" }),
            lineResult({ scope: "pr", message: "pr-wide finding", findingId: "c" }),
            lineResult({ file: "a.ts", startLine: 1, message: "already overflowed", findingId: "d", extraProps: { demoted: "overflow" } }),
          ],
        },
      ],
    };
    const plan = buildMutationPlan(log, [{ filename: "a.ts", status: "modified", patch: "@@ -1,3 +1,3 @@\n l1\n l2\n l3" }], { getHeadLines });
    expect(plan.threads).toHaveLength(1);
    expect(plan.designLevel).toHaveLength(2);
    expect(plan.demotions).toEqual([{ result: expect.objectContaining({ properties: expect.objectContaining({ findingId: "d" }) }), reason: "overflow", pre: true }]);
  });

  it("keeps two findings' suggestion threads non-overlapping when one's coalescing gap intersects the other's fix range (finding B regression, end-to-end)", () => {
    const tenLines = Array.from({ length: 10 }, (_, i) => `l${i + 1}`);
    const getHeadLines = () => tenLines;
    const patch = "@@ -1,10 +1,10 @@\n" + tenLines.map((l) => ` ${l}`).join("\n");
    const fileIndex = buildFileIndex([{ filename: "a.ts", status: "modified", patch }]);

    const findingA = lineResult({
      ruleId: "a-rule",
      file: "a.ts",
      startLine: 3,
      findingId: "a",
      fixes: [fixWithReplacements([
        { file: "a.ts", startLine: 3, endLine: 3, text: "A3" },
        { file: "a.ts", startLine: 6, endLine: 6, text: "A6" },
      ])],
    });
    const findingB = lineResult({
      ruleId: "b-rule",
      file: "a.ts",
      startLine: 5,
      findingId: "b",
      fixes: [fixWithReplacements([{ file: "a.ts", startLine: 5, endLine: 5, text: "B5" }])],
    });

    const log = { runs: [{ results: [findingA, findingB] }] };
    const plan = buildMutationPlan(log, [{ filename: "a.ts", status: "modified", patch }], { getHeadLines });

    expect(plan.threads).toHaveLength(3); // A's two clusters (split, not coalesced) + B's one
    const ranges = plan.threads.map((t) => [t.startLine ?? t.line, t.line]).sort((x, y) => x[0] - y[0]);
    expect(ranges).toEqual([
      [3, 3],
      [5, 5],
      [6, 6],
    ]);
    // No thread's body contains B's proposed content bundled into A's suggestion.
    const threadAt3 = plan.threads.find((t) => t.line === 3);
    expect(threadAt3.body).toContain("A3");
    expect(threadAt3.body).not.toContain("B5");
  });
});

describe("applyDemotions", () => {
  it("stamps properties.demoted on newly demoted results only, leaving pre-demoted ones untouched", () => {
    const log = {
      runs: [{ results: [lineResult({ file: "a.ts", startLine: 1, findingId: "x" }), lineResult({ file: "a.ts", startLine: 2, findingId: "y", extraProps: { demoted: "overflow" } })] }],
    };
    const demotions = [
      { result: log.runs[0].results[0], reason: "location is not on the PR's current diff", pre: false },
      { result: log.runs[0].results[1], reason: "overflow", pre: true },
    ];
    const clone = applyDemotions(log, demotions);
    expect(clone.runs[0].results[0].properties.demoted).toBe("location is not on the PR's current diff");
    expect(clone.runs[0].results[1].properties.demoted).toBe("overflow");
    // original log is untouched (clone, not mutation)
    expect(log.runs[0].results[0].properties.demoted).toBeUndefined();
  });

  it("returns the same log reference when there is nothing new to demote (negative: no-op)", () => {
    const log = { runs: [{ results: [lineResult({ file: "a.ts", startLine: 1, extraProps: { demoted: "overflow" } })] }] };
    const demotions = [{ result: log.runs[0].results[0], reason: "overflow", pre: true }];
    expect(applyDemotions(log, demotions)).toBe(log);
  });
});

describe("toGithubThreadInput", () => {
  it("omits startLine/startSide for a single-line thread", () => {
    expect(toGithubThreadInput({ path: "a.ts", line: 5, body: "m" })).toEqual({ path: "a.ts", line: 5, side: "RIGHT", body: "m" });
  });
  it("includes startLine/startSide for a ranged thread", () => {
    expect(toGithubThreadInput({ path: "a.ts", startLine: 3, line: 5, body: "m" })).toEqual({
      path: "a.ts",
      line: 5,
      side: "RIGHT",
      body: "m",
      startLine: 3,
      startSide: "RIGHT",
    });
  });
});

describe("resolveWorktree", () => {
  let workArea;
  beforeEach(() => {
    workArea = fs.mkdtempSync(path.join(os.tmpdir(), "post-review-wa-"));
  });
  afterEach(() => {
    fs.rmSync(workArea, { recursive: true, force: true });
  });

  it("prefers an explicit --work-area override's state.json over the SARIF's run.properties.workArea", () => {
    fs.writeFileSync(path.join(workArea, "state.json"), JSON.stringify({ worktree: "/from-sarif-workarea" }));
    const overrideWorkArea = fs.mkdtempSync(path.join(os.tmpdir(), "post-review-wa-override-"));
    fs.writeFileSync(path.join(overrideWorkArea, "state.json"), JSON.stringify({ worktree: "/from-override" }));
    try {
      const log = { runs: [{ properties: { workArea } }] };
      expect(resolveWorktree(log, overrideWorkArea)).toBe("/from-override");
    } finally {
      fs.rmSync(overrideWorkArea, { recursive: true, force: true });
    }
  });

  it("falls back to run.properties.workArea's state.json when no override is given", () => {
    fs.writeFileSync(path.join(workArea, "state.json"), JSON.stringify({ worktree: "/from-state" }));
    const log = { runs: [{ properties: { workArea } }] };
    expect(resolveWorktree(log, undefined)).toBe("/from-state");
  });

  it("prefers run.properties.worktree directly (finding #7 / item 7 follow-up) over the workArea->state.json fallback, now that merge-findings.mjs writes it", () => {
    fs.writeFileSync(path.join(workArea, "state.json"), JSON.stringify({ worktree: "/from-state-fallback" }));
    const log = { runs: [{ properties: { workArea, worktree: "/from-properties-direct" } }] };
    expect(resolveWorktree(log, undefined)).toBe("/from-properties-direct");
  });

  it("an explicit --work-area override still wins even when run.properties.worktree is present", () => {
    const overrideWorkArea = fs.mkdtempSync(path.join(os.tmpdir(), "post-review-wa-override2-"));
    fs.writeFileSync(path.join(overrideWorkArea, "state.json"), JSON.stringify({ worktree: "/from-override" }));
    try {
      const log = { runs: [{ properties: { workArea, worktree: "/from-properties-direct" } }] };
      expect(resolveWorktree(log, overrideWorkArea)).toBe("/from-override");
    } finally {
      fs.rmSync(overrideWorkArea, { recursive: true, force: true });
    }
  });

  it("returns undefined when neither is available (negative)", () => {
    expect(resolveWorktree({ runs: [{ properties: {} }] }, undefined)).toBeUndefined();
  });

  it("returns undefined when workArea is given but state.json is missing/unreadable (negative)", () => {
    expect(resolveWorktree({ runs: [{ properties: { workArea: "/definitely/not/a/real/dir" } }] }, undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runFallback — unit-tested against a stub gh (in-process, via $GH)
// ---------------------------------------------------------------------------

describe("runFallback", () => {
  let dir;
  let originalGh;

  function writeStub() {
    const stubPath = path.join(dir, "stub-gh.mjs");
    fs.writeFileSync(
      stubPath,
      `#!/usr/bin/env node
import * as fs from "node:fs";
const scriptPath = process.env.STUB_SCRIPT;
const argvText = process.argv.slice(2).join(" ");
const rules = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
const idx = rules.findIndex((r) => !r.consumed && (r.when == null || new RegExp(r.when).test(argvText)));
if (idx === -1) {
  process.stderr.write("stub-gh: no matching rule for: " + argvText + "\\n");
  process.exit(1);
}
const rule = rules[idx];
rule.consumed = true;
fs.writeFileSync(scriptPath, JSON.stringify(rules));
if (rule.stdout) process.stdout.write(rule.stdout);
if (rule.stderr) process.stderr.write(rule.stderr);
process.exit(rule.status ?? 0);
`,
    );
    fs.chmodSync(stubPath, 0o755);
    return stubPath;
  }

  function setScript(rules) {
    const scriptPath = path.join(dir, "stub-script.json");
    fs.writeFileSync(scriptPath, JSON.stringify(rules));
    process.env.STUB_SCRIPT = scriptPath;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "post-review-fallback-"));
    originalGh = process.env.GH;
    process.env.GH = writeStub();
  });
  afterEach(() => {
    if (originalGh === undefined) delete process.env.GH;
    else process.env.GH = originalGh;
    delete process.env.STUB_SCRIPT;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const thread1 = { path: "a.ts", line: 2, side: "RIGHT", body: `m1\n\n${buildMarker("r-1", 1, 1)}` };
  const thread2 = { path: "a.ts", line: 4, side: "RIGHT", body: `m2\n\n${buildMarker("r-2", 1, 1)}` };

  it("mode 'fallback': no marker-bearing pending review exists, so it creates one and posts every thread", () => {
    setScript([
      { when: "pulls/1/reviews(?:$| )", status: 0, stdout: "[[]]\n" }, // re-list: none pending (slurped: 1 empty page)
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReview":{"pullRequestReview":{"id":"REV1","url":"u"}}}}\n' },
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReviewThread":{"thread":{"id":"T1"}}}}\n' },
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReviewThread":{"thread":{"id":"T2"}}}}\n' },
    ]);
    const { partial, report } = runFallback({
      host: "github.com",
      owner: "acme",
      repo: "widgets",
      number: 1,
      pullRequestId: "PR1",
      body: "review body",
      threads: [thread1, thread2],
      login: "octocat",
      demotedCount: 0,
    });
    expect(partial).toBe(false);
    expect(report).toEqual({ mode: "fallback", posted: 2, demoted: 0, failed: 0 });
  });

  it("mode 'resumed': finds a marker-bearing pending review, skips already-posted threads (by marker), and posts the rest", () => {
    setScript([
      {
        when: "pulls/1/reviews(?:$| )",
        status: 0,
        stdout: `[[{"id":555,"node_id":"REV1","state":"PENDING","user":{"login":"octocat"},"body":"review body\\n\\n${buildMarker("r-1", 1, 1)}"}]]\n`,
      },
      {
        when: "reviews/555/comments",
        status: 0,
        stdout: `[[{"body":"m1\\n\\n${buildMarker("r-1", 1, 1)}"}]]\n`, // thread1 already landed
      },
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReviewThread":{"thread":{"id":"T2"}}}}\n' }, // only thread2 posted
    ]);
    const { partial, report } = runFallback({
      host: "github.com",
      owner: "acme",
      repo: "widgets",
      number: 1,
      pullRequestId: "PR1",
      body: "review body",
      threads: [thread1, thread2],
      login: "octocat",
      demotedCount: 0,
    });
    expect(partial).toBe(false);
    expect(report).toEqual({ mode: "resumed", posted: 2, demoted: 0, failed: 0 });
  });

  it("reports a partial post (exit-5 territory) and appends failed threads to the review body, when one thread fails (negative)", () => {
    setScript([
      { when: "pulls/1/reviews(?:$| )", status: 0, stdout: "[[]]\n" },
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReview":{"pullRequestReview":{"id":"REV1","url":"u"}}}}\n' },
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReviewThread":{"thread":{"id":"T1"}}}}\n' },
      { when: "graphql", status: 1, stderr: "HTTP 422: line is not part of the diff\n" }, // thread2 fails
      { when: "graphql", status: 0, stdout: '{"data":{"updatePullRequestReview":{"pullRequestReview":{"id":"REV1"}}}}\n' }, // body update
    ]);
    const { partial, report } = runFallback({
      host: "github.com",
      owner: "acme",
      repo: "widgets",
      number: 1,
      pullRequestId: "PR1",
      body: "review body",
      threads: [thread1, thread2],
      login: "octocat",
      demotedCount: 1,
    });
    expect(partial).toBe(true);
    expect(report).toEqual({ mode: "fallback", posted: 1, demoted: 2, failed: 1 });
  });
});

// ---------------------------------------------------------------------------
// CLI end-to-end, against the same stub-gh harness
// ---------------------------------------------------------------------------

describe("CLI", () => {
  let dir;
  let repo;

  function writeStub() {
    const stubPath = path.join(dir, "stub-gh.mjs");
    fs.writeFileSync(
      stubPath,
      `#!/usr/bin/env node
import * as fs from "node:fs";
const scriptPath = process.env.STUB_SCRIPT;
const argvText = process.argv.slice(2).join(" ");
const rules = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
const idx = rules.findIndex((r) => !r.consumed && (r.when == null || new RegExp(r.when).test(argvText)));
if (idx === -1) {
  process.stderr.write("stub-gh: no matching rule for: " + argvText + "\\n");
  process.exit(1);
}
const rule = rules[idx];
rule.consumed = true;
fs.writeFileSync(scriptPath, JSON.stringify(rules));
if (rule.stdout) process.stdout.write(rule.stdout);
if (rule.stderr) process.stderr.write(rule.stderr);
process.exit(rule.status ?? 0);
`,
    );
    fs.chmodSync(stubPath, 0o755);
    return stubPath;
  }

  function setScript(rules) {
    fs.writeFileSync(path.join(dir, "stub-script.json"), JSON.stringify(rules));
  }

  function writeSarif(results, { revisionId = "deadbeef00000000000000000000000000000000", workArea } = {}) {
    const sarifPath = path.join(dir, "merged.sarif.json");
    fs.writeFileSync(
      sarifPath,
      JSON.stringify({
        runs: [
          {
            tool: { driver: { name: "code-review", rules: [] } },
            properties: { reviewers: ["typescript"], prNumber: 1, baselineTree: "tree", ...(workArea ? { workArea } : {}) },
            versionControlProvenance: [{ repositoryUri: "https://github.com/acme/widgets", revisionId, branch: "feature-x" }],
            results,
          },
        ],
      }),
    );
    return sarifPath;
  }

  function run(args, env = {}) {
    return spawnSync("node", [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, GH: path.join(dir, "stub-gh.mjs"), STUB_SCRIPT: path.join(dir, "stub-script.json"), ...env },
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "post-review-cli-"));
    writeStub();
    repo = makeFixtureRepo({ "a.ts": "l1\nl2\nl3\nl4\nl5\n" });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    removeDir(repo);
  });

  it("rejects a missing --sarif (negative, exit 2)", () => {
    const r = run(["--pr-url", "https://github.com/acme/widgets/pull/1"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--sarif/);
  });

  it("exits 4 (head drift) and makes no mutation when the PR head no longer matches the SARIF (negative)", () => {
    const sarifPath = writeSarif([]);
    setScript([{ when: "pulls/1$", status: 0, stdout: '{"head":{"sha":"different-sha"},"node_id":"PR_1"}\n' }]);
    const r = run(["--sarif", sarifPath, "--pr-url", "https://github.com/acme/widgets/pull/1"]);
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/PR head moved/);
  });

  it("exits 6 and never deletes a foreign PENDING review (negative)", () => {
    const sarifPath = writeSarif([]);
    setScript([
      { when: "pulls/1$", status: 0, stdout: '{"head":{"sha":"deadbeef00000000000000000000000000000000"},"node_id":"PR_1"}\n' },
      { when: "pulls/1/files", status: 0, stdout: "[[]]\n" },
      { when: "user --jq", status: 0, stdout: "octocat\n" },
      { when: "pulls/1/reviews(?:$| )", status: 0, stdout: '[[{"id":9,"state":"PENDING","user":{"login":"someone-else"},"body":"unrelated draft"}]]\n' },
    ]);
    const r = run(["--sarif", sarifPath, "--pr-url", "https://github.com/acme/widgets/pull/1"]);
    expect(r.status).toBe(6);
    expect(r.stderr).toMatch(/foreign PENDING review/);
  });

  it("dry-run exits 3 when a finding cannot be anchored on the diff (negative)", () => {
    const sarifPath = writeSarif([
      lineResult({ file: "a.ts", startLine: 999, message: "way out of range" }), // no matching hunk range below
    ]);
    setScript([
      { when: "pulls/1$", status: 0, stdout: '{"head":{"sha":"deadbeef00000000000000000000000000000000"},"node_id":"PR_1"}\n' },
      { when: "pulls/1/files", status: 0, stdout: '[[{"filename":"a.ts","status":"modified","patch":"@@ -1,5 +1,5 @@\\n l1\\n l2\\n l3\\n l4\\n l5"}]]\n' },
    ]);
    const r = run(["--sarif", sarifPath, "--pr-url", "https://github.com/acme/widgets/pull/1", "--dry-run"]);
    expect(r.status).toBe(3);
    const out = JSON.parse(r.stdout);
    expect(out.mode).toBe("dry-run");
    expect(out.demotions).toHaveLength(1);
    expect(out.demotions[0].pre).toBe(false);
  });

  it("dry-run exits 0 and prints the exact threads/body for a fully-anchorable plan", () => {
    const sarifPath = writeSarif([lineResult({ file: "a.ts", startLine: 2, message: "off-by-one" })]);
    setScript([
      { when: "pulls/1$", status: 0, stdout: '{"head":{"sha":"deadbeef00000000000000000000000000000000"},"node_id":"PR_1"}\n' },
      { when: "pulls/1/files", status: 0, stdout: '[[{"filename":"a.ts","status":"modified","patch":"@@ -1,5 +1,5 @@\\n l1\\n l2\\n l3\\n l4\\n l5"}]]\n' },
    ]);
    const r = run(["--sarif", sarifPath, "--pr-url", "https://github.com/acme/widgets/pull/1", "--dry-run"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.threads).toEqual([{ path: "a.ts", line: 2, side: "RIGHT", body: expect.stringContaining("off-by-one") }]);
    expect(out.demotions).toEqual([]);
  });

  it("posts a batched review in one GraphQL call and exits 0 on success", () => {
    const sarifPath = writeSarif([lineResult({ file: "a.ts", startLine: 2, message: "off-by-one" })], { workArea: dir });
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ worktree: repo }));
    setScript([
      { when: "pulls/1$", status: 0, stdout: '{"head":{"sha":"deadbeef00000000000000000000000000000000"},"node_id":"PR_1"}\n' },
      { when: "pulls/1/files", status: 0, stdout: '[[{"filename":"a.ts","status":"modified","patch":"@@ -1,5 +1,5 @@\\n l1\\n l2\\n l3\\n l4\\n l5"}]]\n' },
      { when: "user --jq", status: 0, stdout: "octocat\n" },
      { when: "pulls/1/reviews(?:$| )", status: 0, stdout: "[[]]\n" },
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReview":{"pullRequestReview":{"id":"REV1","url":"https://github.com/acme/widgets/pull/1#pullrequestreview-1"}}}}\n' },
    ]);
    const r = run(["--sarif", sarifPath, "--pr-url", "https://github.com/acme/widgets/pull/1"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toEqual({ mode: "batch", posted: 1, demoted: 0, failed: 0, reviewUrl: "https://github.com/acme/widgets/pull/1#pullrequestreview-1" });
  });

  it("deletes our own prior PENDING review (marker-scoped) before posting a fresh one", () => {
    const sarifPath = writeSarif([lineResult({ file: "a.ts", startLine: 2, message: "off-by-one" })], { workArea: dir });
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ worktree: repo }));
    setScript([
      { when: "pulls/1$", status: 0, stdout: '{"head":{"sha":"deadbeef00000000000000000000000000000000"},"node_id":"PR_1"}\n' },
      { when: "pulls/1/files", status: 0, stdout: '[[{"filename":"a.ts","status":"modified","patch":"@@ -1,5 +1,5 @@\\n l1\\n l2\\n l3\\n l4\\n l5"}]]\n' },
      { when: "user --jq", status: 0, stdout: "octocat\n" },
      {
        when: "pulls/1/reviews(?:$| )",
        status: 0,
        stdout: `[[{"id":42,"state":"PENDING","user":{"login":"octocat"},"body":"stale draft\\n\\n<!-- code-review:v1 finding:x part:1/1 -->"}]]\n`,
      },
      {
        when: "reviews/42/comments",
        status: 0,
        stdout: `[[{"body":"note\\n\\n<!-- code-review:v1 finding:x part:1/1 -->"}]]\n`, // every comment also carries our marker — safe to delete
      },
      { when: "reviews/42 -X DELETE", status: 0, stdout: "" },
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReview":{"pullRequestReview":{"id":"REV2","url":"u"}}}}\n' },
    ]);
    const r = run(["--sarif", sarifPath, "--pr-url", "https://github.com/acme/widgets/pull/1"]);
    expect(r.status).toBe(0);
  });

  it("exits 6 and never deletes a PENDING review whose body carries our marker but a comment inside it does not (finding A regression)", () => {
    // A human can open our bot's still-pending review in the GitHub UI and
    // add their own comment before it's submitted — checking only the
    // review's own body would silently destroy that comment on delete.
    const sarifPath = writeSarif([lineResult({ file: "a.ts", startLine: 2, message: "off-by-one" })], { workArea: dir });
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ worktree: repo }));
    setScript([
      { when: "pulls/1$", status: 0, stdout: '{"head":{"sha":"deadbeef00000000000000000000000000000000"},"node_id":"PR_1"}\n' },
      { when: "pulls/1/files", status: 0, stdout: '[[{"filename":"a.ts","status":"modified","patch":"@@ -1,5 +1,5 @@\\n l1\\n l2\\n l3\\n l4\\n l5"}]]\n' },
      { when: "user --jq", status: 0, stdout: "octocat\n" },
      {
        when: "pulls/1/reviews(?:$| )",
        status: 0,
        stdout: `[[{"id":42,"state":"PENDING","user":{"login":"octocat"},"body":"stale draft\\n\\n<!-- code-review:v1 finding:x part:1/1 -->"}]]\n`,
      },
      {
        when: "reviews/42/comments",
        status: 0,
        stdout: `[[{"body":"human note, no marker"}]]\n`, // a comment lacking our marker — NOT safe to delete
      },
    ]);
    const r = run(["--sarif", sarifPath, "--pr-url", "https://github.com/acme/widgets/pull/1"]);
    expect(r.status).toBe(6);
    expect(r.stderr).toMatch(/foreign PENDING review/);
  });

  it("--force-recreate deletes a PENDING review even when a comment inside it lacks our marker", () => {
    const sarifPath = writeSarif([lineResult({ file: "a.ts", startLine: 2, message: "off-by-one" })], { workArea: dir });
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ worktree: repo }));
    setScript([
      { when: "pulls/1$", status: 0, stdout: '{"head":{"sha":"deadbeef00000000000000000000000000000000"},"node_id":"PR_1"}\n' },
      { when: "pulls/1/files", status: 0, stdout: '[[{"filename":"a.ts","status":"modified","patch":"@@ -1,5 +1,5 @@\\n l1\\n l2\\n l3\\n l4\\n l5"}]]\n' },
      { when: "user --jq", status: 0, stdout: "octocat\n" },
      {
        when: "pulls/1/reviews(?:$| )",
        status: 0,
        stdout: `[[{"id":42,"state":"PENDING","user":{"login":"octocat"},"body":"stale draft\\n\\n<!-- code-review:v1 finding:x part:1/1 -->"}]]\n`,
      },
      // --force-recreate skips isPendingReviewFullyOurs entirely — no comments-fetch stub needed.
      { when: "reviews/42 -X DELETE", status: 0, stdout: "" },
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReview":{"pullRequestReview":{"id":"REV2","url":"u"}}}}\n' },
    ]);
    const r = run(["--sarif", sarifPath, "--pr-url", "https://github.com/acme/widgets/pull/1", "--force-recreate"]);
    expect(r.status).toBe(0);
  });

  it("falls back and reports exit 5 on a partial post when the batched GraphQL call fails and one thread can't be reposted", () => {
    const sarifPath = writeSarif(
      [lineResult({ file: "a.ts", startLine: 2, message: "m1", findingId: "r-1" }), lineResult({ file: "a.ts", startLine: 4, message: "m2", findingId: "r-2" })],
      { workArea: dir },
    );
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ worktree: repo }));
    setScript([
      { when: "pulls/1$", status: 0, stdout: '{"head":{"sha":"deadbeef00000000000000000000000000000000"},"node_id":"PR_1"}\n' },
      { when: "pulls/1/files", status: 0, stdout: '[[{"filename":"a.ts","status":"modified","patch":"@@ -1,5 +1,5 @@\\n l1\\n l2\\n l3\\n l4\\n l5"}]]\n' },
      { when: "user --jq", status: 0, stdout: "octocat\n" },
      { when: "pulls/1/reviews(?:$| )", status: 0, stdout: "[[]]\n" }, // no pending before posting
      { when: "graphql", status: 1, stderr: "HTTP 502: upstream timeout\n" }, // batch call fails
      { when: "pulls/1/reviews(?:$| )", status: 0, stdout: "[[]]\n" }, // fallback re-list: still none
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReview":{"pullRequestReview":{"id":"REV1","url":"u"}}}}\n' },
      { when: "graphql", status: 0, stdout: '{"data":{"addPullRequestReviewThread":{"thread":{"id":"T1"}}}}\n' },
      { when: "graphql", status: 1, stderr: "HTTP 422: line is not part of the diff\n" },
      { when: "graphql", status: 0, stdout: '{"data":{"updatePullRequestReview":{"pullRequestReview":{"id":"REV1"}}}}\n' },
    ]);
    const r = run(["--sarif", sarifPath, "--pr-url", "https://github.com/acme/widgets/pull/1"]);
    expect(r.status).toBe(5);
    const out = JSON.parse(r.stdout);
    expect(out).toEqual({ mode: "fallback", posted: 1, demoted: 1, failed: 1 });
  });
});
