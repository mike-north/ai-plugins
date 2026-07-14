/**
 * Tests for record-finding.mjs: finding validation against the HEAD blob, and
 * the snapshot-subtraction fix-capture protocol (single edit, sequential
 * edits attributed correctly, overlap detection + --amend, pure-insertion
 * expansion, and new/binary-file fix representation).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliError, DriftError, ValidationError } from "./lib/cli.mjs";
import { readState } from "./lib/snapshot.mjs";
import { reviewInit } from "./review-init.mjs";
import { recordFinding } from "./record-finding.mjs";
import { git, makeFixtureRepo, removeDir, writeFiles } from "./test-support/git-fixture.mjs";

let repo;
let workArea;

function init(files) {
  repo = makeFixtureRepo(files);
  workArea = `${repo}-wa`; // sibling dir; cleaned up alongside repo
  reviewInit({ workArea, worktree: repo });
  return { repo, workArea };
}

afterEach(() => {
  if (repo) removeDir(repo);
  if (workArea) removeDir(workArea);
  repo = undefined;
  workArea = undefined;
});

function baseFinding(overrides = {}) {
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

describe("recordFinding — validation (no fix)", () => {
  it("records a valid line-scope finding and appends to the reviewer's SARIF log", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    const { filePath, findingId, result } = recordFinding({ workArea, reviewer: "typescript", finding: baseFinding() });
    expect(findingId).toBe("typescript-001");
    expect(result.level).toBe("error");
    expect(fs.existsSync(filePath)).toBe(true);
    const log = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(log.runs[0].results).toHaveLength(1);
    expect(log.runs[0].results[0].properties.findingId).toBe("typescript-001");
  });

  it("assigns sequential, zero-padded findingIds per reviewer", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    const first = recordFinding({ workArea, reviewer: "ts", finding: baseFinding() });
    const second = recordFinding({ workArea, reviewer: "ts", finding: baseFinding({ startLine: 3 }) });
    const other = recordFinding({ workArea, reviewer: "go", finding: baseFinding() });
    expect(first.findingId).toBe("ts-001");
    expect(second.findingId).toBe("ts-002");
    expect(other.findingId).toBe("go-001"); // independent per-reviewer sequence
  });

  it("validates region against the HEAD blob, not the live (edited) file", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    writeFiles(repo, { "a.ts": "line 1\n" }); // live file now only has 1 line
    // startLine 2 is invalid against the *live* file but valid against HEAD (3 lines).
    expect(() =>
      recordFinding({ workArea, reviewer: "ts", finding: baseFinding({ startLine: 2 }) }),
    ).not.toThrow();
  });

  it("rejects a startLine past the end of the HEAD blob", () => {
    init({ "a.ts": "line 1\nline 2\n" });
    expect(() => recordFinding({ workArea, reviewer: "ts", finding: baseFinding({ startLine: 99 }) })).toThrow(
      ValidationError,
    );
  });

  it("rejects an invalid severity/confidence enum", () => {
    init({ "a.ts": "line 1\nline 2\n" });
    expect(() => recordFinding({ workArea, reviewer: "ts", finding: baseFinding({ severity: "fatal" }) })).toThrow(
      ValidationError,
    );
    expect(() => recordFinding({ workArea, reviewer: "ts", finding: baseFinding({ confidence: "certain" }) })).toThrow(
      ValidationError,
    );
  });

  it("rejects a file missing from HEAD", () => {
    init({ "a.ts": "line 1\n" });
    expect(() => recordFinding({ workArea, reviewer: "ts", finding: baseFinding({ file: "nope.ts" }) })).toThrow(
      ValidationError,
    );
  });

  it("rejects scope 'line' without a file, but allows scope 'pr' without one", () => {
    init({ "a.ts": "line 1\n" });
    expect(() =>
      recordFinding({ workArea, reviewer: "ts", finding: baseFinding({ file: undefined }) }),
    ).toThrow(ValidationError);
    expect(() =>
      recordFinding({
        workArea,
        reviewer: "ts",
        finding: { ruleId: "x", severity: "suggestion", confidence: "low", message: "split this PR", scope: "pr" },
      }),
    ).not.toThrow();
  });

  it("all validation failures use the shared exit code 3", () => {
    init({ "a.ts": "line 1\n" });
    try {
      recordFinding({ workArea, reviewer: "ts", finding: baseFinding({ startLine: 99 }) });
      expect.fail("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect(e.exitCode).toBe(3);
    }
  });
});

describe("recordFinding — fix capture (single edit)", () => {
  it("captures a single worktree edit as the finding's fix", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });
    writeFiles(repo, { "a.ts": "line 1\nFIXED\nline 3\n" });

    const { result, fixHunkCount } = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ fixDescription: "Fix the off-by-one" }),
      fixFromWorktree: true,
    });

    expect(fixHunkCount).toBe(1);
    expect(result.fixes).toHaveLength(1);
    const change = result.fixes[0].artifactChanges[0];
    expect(change.artifactLocation.uri).toBe("a.ts");
    expect(change.replacements).toEqual([{ deletedRegion: { startLine: 2, endLine: 2 }, insertedContent: { text: "FIXED" } }]);

    const state = readState(workArea);
    expect(state.findings["ts-001"].hunks).toHaveLength(1);
    expect(state.snapshots).toHaveLength(2); // S0 (init) + S1 (this capture)
  });

  it("expands a pure-insertion fix hunk to anchor a real HEAD line, and marks expandedInsertion", () => {
    init({ "a.ts": "line 1\nline 2\n" });
    writeFiles(repo, { "a.ts": "line 1\nNEW LINE\nline 2\n" }); // pure insertion after line 1

    const { result } = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ startLine: 1 }),
      fixFromWorktree: true,
    });

    const replacement = result.fixes[0].artifactChanges[0].replacements[0];
    expect(replacement).toEqual({ deletedRegion: { startLine: 1, endLine: 1 }, insertedContent: { text: "line 1\nNEW LINE" } });
    expect(result.fixes[0].properties.expandedInsertion).toBe(true);
  });

  it("expands an insertion-before-line-1 fix anchored to line 1", () => {
    init({ "a.ts": "line 1\nline 2\n" });
    writeFiles(repo, { "a.ts": "NEW FIRST\nline 1\nline 2\n" });

    const { result } = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ startLine: 1 }),
      fixFromWorktree: true,
    });

    const replacement = result.fixes[0].artifactChanges[0].replacements[0];
    expect(replacement).toEqual({ deletedRegion: { startLine: 1, endLine: 1 }, insertedContent: { text: "NEW FIRST\nline 1" } });
  });

  it("represents a fix that creates a new file as a kind-only artifactChange", () => {
    init({ "a.ts": "line 1\n" });
    writeFiles(repo, { "a.ts": "line 1\n", "helper.ts": "export const h = 1;\n" });
    git(["add", "-A"], repo); // untracked new file must be staged to appear in `git diff HEAD`

    const { result } = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ startLine: 1, message: "missing helper" }),
      fixFromWorktree: true,
    });

    const change = result.fixes[0].artifactChanges.find((c) => c.artifactLocation.uri === "helper.ts");
    expect(change).toEqual({ artifactLocation: { uri: "helper.ts", uriBaseId: "SRCROOT" }, properties: { kind: "add" } });
    expect(change.replacements).toBeUndefined();
  });

  it("throws a DriftError (exit 4) when --fix-from-worktree finds no new edits", () => {
    init({ "a.ts": "line 1\nline 2\n" }); // clean tree, no edits at all
    expect(() =>
      recordFinding({ workArea, reviewer: "ts", finding: baseFinding(), fixFromWorktree: true }),
    ).toThrow(DriftError);
  });
});

describe("recordFinding — sequential fix capture", () => {
  it("attributes each finding's own edit correctly across two sequential captures", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\nline 4\nline 5\n" });

    writeFiles(repo, { "a.ts": "FIXED 1\nline 2\nline 3\nline 4\nline 5\n" });
    const first = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ startLine: 1 }),
      fixFromWorktree: true,
    });

    writeFiles(repo, { "a.ts": "FIXED 1\nline 2\nline 3\nline 4\nFIXED 5\n" });
    const second = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ startLine: 5 }),
      fixFromWorktree: true,
    });

    // Each finding's fix contains only its OWN edit, not the other's.
    expect(first.result.fixes[0].artifactChanges[0].replacements).toEqual([
      { deletedRegion: { startLine: 1, endLine: 1 }, insertedContent: { text: "FIXED 1" } },
    ]);
    expect(second.result.fixes[0].artifactChanges[0].replacements).toEqual([
      { deletedRegion: { startLine: 5, endLine: 5 }, insertedContent: { text: "FIXED 5" } },
    ]);

    const state = readState(workArea);
    expect(state.findings["ts-001"].hunks).toHaveLength(1);
    expect(state.findings["ts-002"].hunks).toHaveLength(1);
  });
});

describe("recordFinding — overlap detection and --amend", () => {
  it("throws a DriftError naming both findings when a third edit modifies an already-captured region", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });

    writeFiles(repo, { "a.ts": "FIXED 1\nline 2\nline 3\n" });
    const first = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ startLine: 1 }),
      fixFromWorktree: true,
    });

    // Modify the SAME region again (without amend) — this is an overlap.
    writeFiles(repo, { "a.ts": "FIXED 1 AGAIN\nline 2\nline 3\n" });
    let error;
    try {
      recordFinding({ workArea, reviewer: "ts", finding: baseFinding({ startLine: 1, message: "second look" }), fixFromWorktree: true });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DriftError);
    expect(error.message).toContain(first.findingId);
  });

  it("--amend merges the overlapping region into the named finding's fix, attributing the remainder to the current finding", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });

    writeFiles(repo, { "a.ts": "FIXED 1\nline 2\nline 3\n" });
    const first = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ startLine: 1, message: "first pass" }),
      fixFromWorktree: true,
    });

    // Edit line 1 again (overlap with `first`) AND independently edit line 3 (belongs to the new finding).
    writeFiles(repo, { "a.ts": "FIXED 1 AGAIN\nline 2\nFIXED 3\n" });
    const second = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ startLine: 3, message: "second pass" }),
      fixFromWorktree: true,
      amendId: first.findingId,
    });

    // The current finding's own fix only carries the line-3 edit (the remainder).
    expect(second.result.fixes[0].artifactChanges[0].replacements).toEqual([
      { deletedRegion: { startLine: 3, endLine: 3 }, insertedContent: { text: "FIXED 3" } },
    ]);

    // The amended finding's fix, re-read from its SARIF log, now carries the merged (latest) line-1 edit.
    const log = JSON.parse(fs.readFileSync(path.join(workArea, "findings", "ts.sarif.json"), "utf8"));
    const amended = log.runs[0].results.find((r) => r.properties.findingId === first.findingId);
    expect(amended.fixes[0].artifactChanges[0].replacements).toEqual([
      { deletedRegion: { startLine: 1, endLine: 1 }, insertedContent: { text: "FIXED 1 AGAIN" } },
    ]);

    const state = readState(workArea);
    expect(state.findings[first.findingId].hunks).toHaveLength(1);
    expect(state.findings[second.findingId].hunks).toHaveLength(1);
  });

  it("still throws when --amend does not cover every vanished hunk", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });

    writeFiles(repo, { "a.ts": "FIXED 1\nline 2\nline 3\n" });
    const first = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ startLine: 1 }),
      fixFromWorktree: true,
    });

    writeFiles(repo, { "a.ts": "FIXED 1\nline 2\nFIXED 3\n" });
    const second = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ startLine: 3, message: "third region" }),
      fixFromWorktree: true,
    });

    // Now overlap BOTH first's and second's regions in one edit, but only amend `first`.
    writeFiles(repo, { "a.ts": "FIXED 1 AGAIN\nline 2\nFIXED 3 AGAIN\n" });
    expect(() =>
      recordFinding({
        workArea,
        reviewer: "ts",
        finding: baseFinding({ startLine: 2, message: "fourth" }),
        fixFromWorktree: true,
        amendId: first.findingId,
      }),
    ).toThrow(DriftError);
    void second;
  });
});

function tenLineFile() {
  return Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
}

describe("recordFinding — cross-reviewer --amend atomicity (finding #6 regression)", () => {
  it("writes state.json before the cross-reviewer amended log, so a crash in between leaves state.json (the source of truth for merge-findings' partition check) already consistent", () => {
    init({ "a.ts": "line 1\nline 2\nline 3\n" });

    writeFiles(repo, { "a.ts": "FIXED 1\nline 2\nline 3\n" });
    const first = recordFinding({
      workArea,
      reviewer: "go", // a DIFFERENT reviewer than the amending call below
      finding: baseFinding({ startLine: 1, message: "first pass" }),
      fixFromWorktree: true,
    });

    // Force the cross-reviewer log write specifically to fail, by occupying
    // its atomic-write temp path (same fault-injection technique as the
    // blocker #3 atomicity tests) — everything else must still succeed.
    const otherLogPath = path.join(workArea, "findings", "go.sarif.json");
    fs.mkdirSync(`${otherLogPath}.tmp-${process.pid}`);

    writeFiles(repo, { "a.ts": "FIXED 1 AGAIN\nline 2\nFIXED 3\n" });
    expect(() =>
      recordFinding({
        workArea,
        reviewer: "ts",
        finding: baseFinding({ startLine: 3, message: "second pass" }),
        fixFromWorktree: true,
        amendId: first.findingId,
      }),
    ).toThrow();

    // state.json already reflects the amend (the merged, latest line-1 hunk) —
    // it was written BEFORE the cross-reviewer log write that then failed.
    const state = readState(workArea);
    expect(state.findings[first.findingId].hunks[0]).toMatchObject({ oldStart: 1, newLines: ["FIXED 1 AGAIN"] });

    // go.sarif.json itself is untouched (its own write is atomic — blocker #3)
    // — still shows the pre-amend fix, not a torn write. This is the accepted,
    // milder failure mode: a briefly-stale *displayed* fix, not a false
    // "hunk vanished" overlap error on the next capture (see the code comment
    // in record-finding.mjs for the full reasoning).
    const goLog = JSON.parse(fs.readFileSync(otherLogPath, "utf8"));
    const amended = goLog.runs[0].results.find((r) => r.properties.findingId === first.findingId);
    expect(amended.fixes[0].artifactChanges[0].replacements[0].insertedContent.text).toBe("FIXED 1");
  });
});

describe("recordFinding — adjacent-edit false-positive (blocker #2 regression)", () => {
  // Regression tests for: git's -U0 diff merges a captured fix with a
  // zero-context-gap adjacent, unrelated edit into ONE hunk, which the old
  // exact-hunk-key overlap check misreported as a conflict (DriftError) even
  // though the captured fix's own before/after text was never touched.

  it("does not throw when an edit is inserted immediately AFTER a captured single-line fix; the earlier finding's own hunk is untouched", () => {
    init({ "a.ts": tenLineFile() });
    writeFiles(repo, {
      "a.ts": Array.from({ length: 10 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`)).join("\n") + "\n",
    });
    const first = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ file: "a.ts", startLine: 10, message: "off-by-one at EOF" }),
      fixFromWorktree: true,
    });

    const lines = Array.from({ length: 10 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`));
    lines.splice(10, 0, "NEWLINE1", "NEWLINE2"); // inserted with ZERO unchanged lines of gap after line 10
    writeFiles(repo, { "a.ts": lines.join("\n") + "\n" });

    let second;
    expect(() => {
      second = recordFinding({
        workArea,
        reviewer: "ts",
        finding: baseFinding({ file: "a.ts", startLine: 10, message: "missing trailing content" }),
        fixFromWorktree: true,
      });
    }).not.toThrow();

    const state = readState(workArea);
    expect(state.findings[first.findingId].hunks).toHaveLength(1);
    expect(state.findings[first.findingId].hunks[0]).toMatchObject({
      oldStart: 10,
      oldCount: 1,
      newLines: ["line10 FIXED"],
    }); // the earlier finding's OWN recorded hunk is exactly as it was — untouched by the merge

    // Design decision (flagged for review): since git -U0 merges the two edits into
    // one hunk with no way to tell them apart syntactically, the NEW finding's own
    // captured fix attributes the WHOLE merged hunk — which incidentally also
    // carries the earlier finding's already-fixed text. This trades a small,
    // cosmetic redundancy (the new finding's suggested-fix diff shows a line it
    // didn't itself change) for correctness: no false DriftError, no misattribution
    // as an "overlap" requiring --amend.
    expect(second.result.fixes[0].artifactChanges[0].replacements).toEqual([
      {
        deletedRegion: { startLine: 10, endLine: 10 },
        insertedContent: { text: "line10 FIXED\nNEWLINE1\nNEWLINE2" },
      },
    ]);
  });

  it("does not throw when an edit is inserted immediately BEFORE a captured single-line fix", () => {
    init({ "a.ts": tenLineFile() });
    writeFiles(repo, {
      "a.ts": Array.from({ length: 10 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`)).join("\n") + "\n",
    });
    const first = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ file: "a.ts", startLine: 10, message: "off-by-one at EOF" }),
      fixFromWorktree: true,
    });

    const lines = Array.from({ length: 10 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`));
    lines.splice(9, 0, "NEWBEFORE1", "NEWBEFORE2"); // inserted immediately before line 10, zero-gap
    writeFiles(repo, { "a.ts": lines.join("\n") + "\n" });

    let second;
    expect(() => {
      second = recordFinding({
        workArea,
        reviewer: "ts",
        finding: baseFinding({ file: "a.ts", startLine: 10, message: "missing preceding content" }),
        fixFromWorktree: true,
      });
    }).not.toThrow();

    const state = readState(workArea);
    expect(state.findings[first.findingId].hunks).toHaveLength(1);
    expect(state.findings[first.findingId].hunks[0]).toMatchObject({ oldStart: 10, oldCount: 1, newLines: ["line10 FIXED"] });
  });

  it("a genuine multi-line gap still attributes each fix to its own finding — no change from before (negative: adjacency fix must not over-merge)", () => {
    init({ "a.ts": Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join("\n") + "\n" });
    writeFiles(repo, {
      "a.ts": Array.from({ length: 15 }, (_, i) => (i === 4 ? "line5 FIXED" : `line${i + 1}`)).join("\n") + "\n",
    });
    const first = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ file: "a.ts", startLine: 5 }),
      fixFromWorktree: true,
    });

    writeFiles(repo, {
      "a.ts":
        Array.from({ length: 15 }, (_, i) => {
          if (i === 4) return "line5 FIXED";
          if (i === 9) return "line10 FIXED"; // 4-line gap (lines 6-9 untouched) — not adjacent
          return `line${i + 1}`;
        }).join("\n") + "\n",
    });
    const second = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ file: "a.ts", startLine: 10 }),
      fixFromWorktree: true,
    });

    // Second's fix carries ONLY its own line — not merged with first's.
    expect(second.result.fixes[0].artifactChanges[0].replacements).toEqual([
      { deletedRegion: { startLine: 10, endLine: 10 }, insertedContent: { text: "line10 FIXED" } },
    ]);
    const state = readState(workArea);
    expect(state.findings[first.findingId].hunks).toHaveLength(1);
    expect(state.findings[second.findingId].hunks).toHaveLength(1);
  });

  it("recognizes a captured fix's file identity across a rename, avoiding a false overlap DriftError", () => {
    // Git only detects a rename above its default 50% content-similarity
    // threshold, so this fixture keeps the file large enough that a one-line
    // fix plus a later one-line addition still leaves it well above that bar
    // (a small, realistic edit alongside a rename, not a near-total rewrite).
    init({ "old.ts": tenLineFile() });
    writeFiles(repo, {
      "old.ts": Array.from({ length: 10 }, (_, i) => (i === 1 ? "FIXED" : `line${i + 1}`)).join("\n") + "\n",
    });
    const first = recordFinding({
      workArea,
      reviewer: "ts",
      finding: baseFinding({ file: "old.ts", startLine: 2 }),
      fixFromWorktree: true,
    });

    git(["mv", "old.ts", "new.ts"], repo); // rename, fix content intact
    const withFooter = Array.from({ length: 10 }, (_, i) => (i === 1 ? "FIXED" : `line${i + 1}`));
    withFooter.push("FOOTER"); // + an unrelated new edit under the new name
    writeFiles(repo, { "new.ts": withFooter.join("\n") + "\n" });

    // finding.file must still be HEAD-relative (HEAD only knows "old.ts" — nothing is
    // committed here); the underlying captured fix correctly resolves under the live
    // tree's renamed path via the rename map, independent of this validation path.
    let second;
    expect(() => {
      second = recordFinding({
        workArea,
        reviewer: "ts",
        finding: baseFinding({ file: "old.ts", startLine: 10, message: "missing footer" }),
        fixFromWorktree: true,
      });
    }).not.toThrow();

    const state = readState(workArea);
    expect(state.findings[first.findingId].hunks).toHaveLength(1); // unchanged by the rename
    expect(second.fixHunkCount).toBeGreaterThan(0);
  });
});
