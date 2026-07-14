/**
 * Tests for merge-findings.mjs: provenance consistency, the partition check
 * (uncaptured / reverted edits), dedupe determinism, ordering, and the
 * inline cap.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError, DriftError } from "./lib/cli.mjs";

// Wraps (not replaces) lib/snapshot.mjs's withLock with a spy, so tests can
// verify mergeFindings acquires it — a real module mock, since Node's ESM `fs`
// namespace and its sibling built-ins can't be spied on directly in vitest
// (see lib/snapshot.test.mjs's atomicity tests for the same constraint).
vi.mock("./lib/snapshot.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, withLock: vi.fn(actual.withLock) };
});

import { withLock } from "./lib/snapshot.mjs";
import {
  applyInlineCap,
  assertConsistentProvenance,
  mergeFindings,
  resolveDuplicates,
} from "./merge-findings.mjs";
import { recordFinding } from "./record-finding.mjs";
import { reviewInit } from "./review-init.mjs";
import { git, makeFixtureRepo, removeDir, writeFiles } from "./test-support/git-fixture.mjs";

let repo;
let workArea;

function init(files) {
  repo = makeFixtureRepo(files);
  workArea = `${repo}-wa`;
  reviewInit({ workArea, worktree: repo });
  return { repo, workArea };
}

afterEach(() => {
  if (repo) removeDir(repo);
  if (workArea) removeDir(workArea);
  repo = undefined;
  workArea = undefined;
});

function finding(overrides = {}) {
  return {
    ruleId: "logic-bug",
    severity: "critical",
    confidence: "high",
    message: "off-by-one error",
    file: "a.ts",
    startLine: 2,
    ...overrides,
  };
}

describe("assertConsistentProvenance", () => {
  it("passes when all logs agree", () => {
    const logs = [
      { runs: [{ properties: { baselineTree: "t1" }, versionControlProvenance: [{ revisionId: "r1" }] }] },
      { runs: [{ properties: { baselineTree: "t1" }, versionControlProvenance: [{ revisionId: "r1" }] }] },
    ];
    expect(assertConsistentProvenance(logs)).toEqual({ baselineTree: "t1", revisionId: "r1" });
  });

  it("throws a DriftError on baselineTree mismatch", () => {
    const logs = [
      { runs: [{ properties: { baselineTree: "t1" } }] },
      { runs: [{ properties: { baselineTree: "t2" } }] },
    ];
    expect(() => assertConsistentProvenance(logs)).toThrow(DriftError);
  });

  it("throws a DriftError on revisionId mismatch", () => {
    const logs = [
      { runs: [{ properties: {}, versionControlProvenance: [{ revisionId: "r1" }] }] },
      { runs: [{ properties: {}, versionControlProvenance: [{ revisionId: "r2" }] }] },
    ];
    expect(() => assertConsistentProvenance(logs)).toThrow(DriftError);
  });

  it("tolerates logs that omit versionControlProvenance", () => {
    const logs = [{ runs: [{ properties: { baselineTree: "t1" } }] }, { runs: [{ properties: { baselineTree: "t1" } }] }];
    expect(() => assertConsistentProvenance(logs)).not.toThrow();
  });
});

describe("mergeFindings — partition check", () => {
  it("throws when the worktree has edits not attributed to any finding", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    recordFinding({ workArea, reviewer: "ts", finding: finding() }); // no fix captured
    writeFiles(repo, { "a.ts": "line 1\nUNCAPTURED\nline 3\n" }); // live edit, never recorded as a fix
    expect(() => mergeFindings({ workArea })).toThrow(DriftError);
  });

  it("demotes uncaptured edits to a synthetic finding with --allow-unattributed", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    recordFinding({ workArea, reviewer: "ts", finding: finding() });
    writeFiles(repo, { "a.ts": "line 1\nUNCAPTURED\nline 3\n" });
    const { log, summary } = mergeFindings({ workArea, allowUnattributed: true });
    expect(summary.unattributed).toBe(1);
    const synthetic = log.runs[0].results.find((r) => r.ruleId === "unattributed-changes");
    expect(synthetic).toBeDefined();
    expect(synthetic.properties.scope).toBe("pr");
  });

  it("throws when a recorded fix's hunk is no longer present (reverted)", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    writeFiles(repo, { "a.ts": "FIXED\nline 2\nline 3\n" });
    recordFinding({ workArea, reviewer: "ts", finding: finding({ startLine: 1 }), fixFromWorktree: true });
    writeFiles(repo, { "a.ts": "line 1\nline 2\nline 3\n" }); // revert back to HEAD content
    expect(() => mergeFindings({ workArea })).toThrow(/no longer present/);
  });

  it("passes when every worktree hunk is attributed to a recorded fix", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    writeFiles(repo, { "a.ts": "FIXED\nline 2\nline 3\n" });
    recordFinding({ workArea, reviewer: "ts", finding: finding({ startLine: 1 }), fixFromWorktree: true });
    expect(() => mergeFindings({ workArea })).not.toThrow();
  });

  it("passes on a clean worktree with only non-fix findings recorded", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    recordFinding({ workArea, reviewer: "ts", finding: finding() });
    const { summary } = mergeFindings({ workArea });
    expect(summary.total).toBe(1);
    expect(summary.unattributed).toBe(0);
  });

  it("does not falsely report a captured fix as reverted when a later, adjacent finding's fix merges with it into one live hunk (blocker #2 regression)", () => {
    // Same root cause as record-finding.mjs's adjacent-edit fix: git's -U0 diff
    // merges finding A's fix with finding B's zero-gap-adjacent edit into ONE
    // live hunk. A's own recorded hunk (the narrower, original one) must still
    // be recognized as present within that merged live hunk.
    const tenLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    init({ "a.ts": tenLines });
    writeFiles(repo, {
      "a.ts": Array.from({ length: 10 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`)).join("\n") + "\n",
    });
    recordFinding({ workArea, reviewer: "ts", finding: finding({ file: "a.ts", startLine: 10 }), fixFromWorktree: true });

    const lines = Array.from({ length: 10 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`));
    lines.splice(10, 0, "NEWLINE1", "NEWLINE2"); // zero-gap adjacent insertion after line 10
    writeFiles(repo, { "a.ts": lines.join("\n") + "\n" });
    // A distinct declared location/ruleId for finding B — its OWN reported
    // location is independent of where its *captured fix* actually lands
    // (that comes from the live diff), so this avoids an unrelated dedupe
    // collision with finding A (same-location, same-ruleId findings are
    // merged by mergeFindings' own dedupe logic, which is not what this test
    // is exercising).
    recordFinding({
      workArea,
      reviewer: "ts",
      finding: finding({ file: "a.ts", startLine: 1, ruleId: "missing-content", message: "missing trailing content" }),
      fixFromWorktree: true,
    });

    expect(() => mergeFindings({ workArea })).not.toThrow();
    const { summary } = mergeFindings({ workArea });
    expect(summary.unattributed).toBe(0);
  });

  it("does not falsely report a captured fix as reverted after the file is renamed (blocker #2 regression)", () => {
    const tenLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    init({ "old.ts": tenLines });
    writeFiles(repo, {
      "old.ts": Array.from({ length: 10 }, (_, i) => (i === 1 ? "FIXED" : `line${i + 1}`)).join("\n") + "\n",
    });
    recordFinding({ workArea, reviewer: "ts", finding: finding({ file: "old.ts", startLine: 2 }), fixFromWorktree: true });

    git(["mv", "old.ts", "new.ts"], repo);

    expect(() => mergeFindings({ workArea })).not.toThrow();
  });
});

describe("mergeFindings — binary/mode changes always surfaced (blocker #4 / finding #7 regression)", () => {
  // Regression tests for: a binary or mode-only worktree change carries no
  // line-level hunks at all, so it was completely invisible to the
  // hunk-based partition check — it could reach GitHub with zero review
  // commentary, regardless of --allow-unattributed. Now always surfaced as
  // its own unconditional PR-scope finding.

  it("surfaces a binary-changes finding for a modified binary file, without --allow-unattributed and without throwing", () => {
    init({ "a.ts": "line 1\nline 2\n" });
    recordFinding({ workArea, reviewer: "ts", finding: finding() }); // no fix — a.ts is clean
    fs.writeFileSync(path.join(repo, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    git(["add", "-A"], repo);

    const { log, summary } = mergeFindings({ workArea });
    const synthetic = log.runs[0].results.find((r) => r.ruleId === "binary-changes");
    expect(synthetic).toBeDefined();
    expect(synthetic.properties.scope).toBe("pr");
    expect(synthetic.properties.demoted).toBeUndefined(); // always visible, never demoted to an appendix
    expect(synthetic.message.text).toContain("img.png");
    expect(summary.unattributed).toBe(0); // distinct from the hunk-based "unattributed" count
  });

  it("surfaces a binary-changes finding for a mode-only change (chmod), without throwing", () => {
    init({ "script.sh": "line 1\nline 2\n" });
    recordFinding({ workArea, reviewer: "ts", finding: finding({ file: "script.sh" }) });
    fs.chmodSync(path.join(repo, "script.sh"), 0o755);

    const { log } = mergeFindings({ workArea });
    const synthetic = log.runs[0].results.find((r) => r.ruleId === "binary-changes");
    expect(synthetic).toBeDefined();
    expect(synthetic.message.text).toContain("script.sh");
  });

  it("surfaces both a binary-changes finding and (with --allow-unattributed) an unattributed-changes finding when both are present", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    recordFinding({ workArea, reviewer: "ts", finding: finding() });
    writeFiles(repo, { "a.ts": "line 1\nUNCAPTURED\nline 3\n" }); // uncaptured text edit
    fs.writeFileSync(path.join(repo, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])); // NUL byte -> git treats as binary
    git(["add", "-A"], repo);

    const { log, summary } = mergeFindings({ workArea, allowUnattributed: true });
    expect(log.runs[0].results.find((r) => r.ruleId === "binary-changes")).toBeDefined();
    expect(log.runs[0].results.find((r) => r.ruleId === "unattributed-changes")).toBeDefined();
    expect(summary.unattributed).toBe(1);
  });
});

describe("mergeFindings — lock (blocker #3 regression)", () => {
  // Regression test for: mergeFindings read state.json and every reviewer's
  // SARIF log without ever acquiring the work area's lock, unlike
  // record-finding.mjs — so a concurrent record-finding call (writing those
  // same files under the lock) could race a merge that reads them.
  it("acquires the work area's lock while reading state/logs", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    recordFinding({ workArea, reviewer: "ts", finding: finding() });
    withLock.mockClear();

    mergeFindings({ workArea });

    expect(withLock).toHaveBeenCalledTimes(1);
    expect(withLock.mock.calls[0][0]).toBe(path.resolve(workArea));
  });
});

describe("mergeFindings — dedupe", () => {
  function findingEntry(reviewer, props, msg) {
    return {
      reviewer,
      result: {
        ruleId: props.ruleId,
        level: props.level ?? "error",
        message: { text: msg },
        locations: props.uri
          ? [{ physicalLocation: { artifactLocation: { uri: props.uri }, region: props.region } }]
          : undefined,
        properties: {
          findingId: props.findingId,
          confidence: props.confidence ?? "high",
          reviewer,
          scope: props.scope ?? "line",
        },
        ...(props.fix ? { fixes: [{ description: { text: "fix" }, artifactChanges: [] }] } : {}),
      },
    };
  }

  it("merges two findings with the same ruleId and overlapping region, keeping the higher-confidence one and recording corroboratedBy", () => {
    const entries = [
      findingEntry("ts", { ruleId: "bug", findingId: "ts-001", uri: "a.ts", region: { startLine: 5, endLine: 5 }, confidence: "medium" }, "off by one error here"),
      findingEntry("go", { ruleId: "bug", findingId: "go-001", uri: "a.ts", region: { startLine: 5, endLine: 6 }, confidence: "high" }, "off by one issue"),
    ];
    const winners = resolveDuplicates(entries);
    expect(winners).toHaveLength(1);
    expect(winners[0].result.properties.findingId).toBe("go-001"); // higher confidence wins
    expect(winners[0].result.properties.corroboratedBy).toEqual(["ts"]);
    expect(winners[0].result.properties.confidence).toBe("high"); // already at ceiling, stays high
  });

  it("bumps confidence one step when a lower-confidence winner is corroborated", () => {
    const entries = [
      findingEntry("ts", { ruleId: "bug", findingId: "ts-001", uri: "a.ts", region: { startLine: 5, endLine: 5 }, confidence: "low" }, "missing null check"),
      findingEntry("go", { ruleId: "bug", findingId: "go-001", uri: "a.ts", region: { startLine: 5, endLine: 5 }, confidence: "low", level: "warning" }, "missing null check here"),
    ];
    // ts-001 wins on level (error > warning) despite equal confidence.
    const winners = resolveDuplicates(entries);
    expect(winners[0].result.properties.findingId).toBe("ts-001");
    expect(winners[0].result.properties.confidence).toBe("medium"); // bumped once from low
  });

  it("does not merge findings on unrelated lines even with the same ruleId", () => {
    const entries = [
      findingEntry("ts", { ruleId: "bug", findingId: "ts-001", uri: "a.ts", region: { startLine: 5, endLine: 5 } }, "m1"),
      findingEntry("go", { ruleId: "bug", findingId: "go-001", uri: "a.ts", region: { startLine: 50, endLine: 50 } }, "m2"),
    ];
    expect(resolveDuplicates(entries)).toHaveLength(2);
  });

  it("merges different ruleIds on the same region when message similarity is high enough", () => {
    const entries = [
      findingEntry("ts", { ruleId: "bug-a", findingId: "ts-001", uri: "a.ts", region: { startLine: 5, endLine: 5 } }, "missing error handling around network"),
      findingEntry("go", { ruleId: "bug-b", findingId: "go-001", uri: "a.ts", region: { startLine: 5, endLine: 5 } }, "missing error handling network calls"),
    ];
    expect(resolveDuplicates(entries)).toHaveLength(1);
  });

  it("never drops a fix: throws if a losing finding in a cluster has a fix", () => {
    // has-fix outranks confidence in the winner tie-break, so to construct a
    // losing-but-fixed finding it must first lose on `level` (a higher-priority
    // criterion): ts-001 has a fix but only "note" level; go-001 has no fix but
    // outranks it on level ("error"), so go-001 wins and ts-001's fix is dropped.
    const entries = [
      findingEntry("ts", { ruleId: "bug", findingId: "ts-001", uri: "a.ts", region: { startLine: 5, endLine: 5 }, confidence: "low", level: "note", fix: true }, "m"),
      findingEntry("go", { ruleId: "bug", findingId: "go-001", uri: "a.ts", region: { startLine: 5, endLine: 5 }, confidence: "high", level: "error" }, "m"),
    ];
    expect(() => resolveDuplicates(entries)).toThrow(/never drop a fix|has a fix but lost/);
  });

  it("is deterministic across repeated calls on the same input", () => {
    const entries = [
      findingEntry("ts", { ruleId: "bug", findingId: "ts-001", uri: "a.ts", region: { startLine: 5, endLine: 5 } }, "m"),
      findingEntry("go", { ruleId: "bug", findingId: "go-001", uri: "a.ts", region: { startLine: 5, endLine: 5 } }, "m"),
    ];
    const first = JSON.stringify(resolveDuplicates(entries.map((e) => structuredClone(e))));
    const second = JSON.stringify(resolveDuplicates(entries.map((e) => structuredClone(e))));
    expect(first).toBe(second);
  });

  it("scope 'file' dedupes on uri alone (no region compare); scope 'pr' dedupes across any uri", () => {
    const fileEntries = [
      findingEntry("ts", { ruleId: "arch", findingId: "ts-001", uri: "a.ts", scope: "file" }, "layering"),
      findingEntry("go", { ruleId: "arch", findingId: "go-001", uri: "a.ts", scope: "file" }, "layering"),
    ];
    expect(resolveDuplicates(fileEntries)).toHaveLength(1);

    const prEntries = [
      findingEntry("ts", { ruleId: "process", findingId: "ts-001", scope: "pr" }, "split this pr"),
      findingEntry("go", { ruleId: "process", findingId: "go-001", scope: "pr" }, "split this pr"),
    ];
    expect(resolveDuplicates(prEntries)).toHaveLength(1);
  });
});

describe("applyInlineCap", () => {
  function lineEntry(id) {
    return { result: { properties: { findingId: id, scope: "line" } } };
  }
  function fileEntry(id) {
    return { result: { properties: { findingId: id, scope: "file" } } };
  }

  it("demotes line-scoped findings beyond the cap, leaving earlier ones untouched", () => {
    const entries = [lineEntry("a"), lineEntry("b"), lineEntry("c")];
    applyInlineCap(entries, 2);
    expect(entries[0].result.properties.demoted).toBeUndefined();
    expect(entries[1].result.properties.demoted).toBeUndefined();
    expect(entries[2].result.properties.demoted).toBe("overflow");
  });

  it("never demotes scope file/pr findings, and they do not consume a cap slot", () => {
    const entries = [fileEntry("f1"), lineEntry("a"), lineEntry("b"), fileEntry("f2")];
    applyInlineCap(entries, 1);
    expect(entries[0].result.properties.demoted).toBeUndefined(); // file — never demoted
    expect(entries[1].result.properties.demoted).toBeUndefined(); // 1st line — within cap
    expect(entries[2].result.properties.demoted).toBe("overflow"); // 2nd line — over cap
    expect(entries[3].result.properties.demoted).toBeUndefined(); // file — never demoted
  });
});

describe("mergeFindings — end-to-end", () => {
  it("produces a single merged run with a reviewers list and orders by level/confidence/uri/startLine", () => {
    init({ "a.ts": "l1\nl2\nl3\nl4\nl5\n" });
    recordFinding({ workArea, reviewer: "ts", finding: finding({ startLine: 4, severity: "suggestion", confidence: "low", ruleId: "nit" }) });
    recordFinding({ workArea, reviewer: "go", finding: finding({ startLine: 1, severity: "critical", confidence: "high", ruleId: "bug" }) });

    const { log, summary } = mergeFindings({ workArea });
    expect(log.runs[0].tool.driver.name).toBe("code-review");
    expect(log.runs[0].properties.reviewers).toEqual(["go", "ts"]);
    // post-review/render-review resolve the worktree from the merged SARIF alone
    expect(log.runs[0].properties.workArea).toBe(path.resolve(workArea));
    expect(log.runs[0].properties.worktree).toBe(path.resolve(repo));
    expect(summary.total).toBe(2);
    expect(summary.merged).toBe(2);
    // error (bug, line 1) sorts before note/suggestion (nit, line 4)
    expect(log.runs[0].results[0].ruleId).toBe("bug");
    expect(log.runs[0].results[1].ruleId).toBe("nit");
  });

  it("rejects missing --work-area at the CLI-args level via a usage error", () => {
    expect(() => mergeFindings({})).toThrow(CliError);
  });
});
