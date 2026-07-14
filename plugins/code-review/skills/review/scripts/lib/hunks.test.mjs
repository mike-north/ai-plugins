/**
 * Tests for the pure diff-hunk parsing/set utilities used by the
 * snapshot-subtraction fix-capture protocol.
 *
 * Hunk parsing is exercised against *real* `git diff -U0` output (not
 * hand-written diff text) so the parser is verified against git's actual
 * format, including adjacent edits, pure insertions/deletions, and
 * no-trailing-newline files.
 *
 * @see https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Unified.html
 */
import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { git, makeFixtureRepo, removeDir, writeFiles } from "../test-support/git-fixture.mjs";
import {
  buildRenameMap,
  hunkKey,
  oldRangesOverlap,
  parseHunks,
  parseUnifiedDiff,
  rangeContains,
  resolveHunkSurvival,
  subtractHunks,
} from "./hunks.mjs";

let repo;

afterEach(() => {
  if (repo) removeDir(repo);
  repo = undefined;
});

/** git diff -U0 between HEAD and the current worktree state. */
function diffHeadToWorktree(dir) {
  return git(["diff", "-U0", "--no-color", "HEAD"], dir);
}

describe("parseUnifiedDiff — modifications", () => {
  it("parses a single-line replacement", () => {
    repo = makeFixtureRepo({ "a.txt": "one\ntwo\nthree\n" });
    writeFiles(repo, { "a.txt": "one\nTWO\nthree\n" });
    const { hunks, files } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      file: "a.txt",
      oldStart: 2,
      oldCount: 1,
      newStart: 2,
      newCount: 1,
      oldLines: ["two"],
      newLines: ["TWO"],
    });
    expect(files).toEqual([{ file: "a.txt", kind: "modify" }]);
  });

  it("parses two adjacent (non-contiguous) edits in one file as two hunks", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n3\n4\n5\n6\n7\n8\n" });
    writeFiles(repo, { "a.txt": "1\nTWO\n3\n4\n5\nSIX\n7\n8\n" });
    const { hunks } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ oldStart: 2, oldCount: 1, oldLines: ["2"], newLines: ["TWO"] });
    expect(hunks[1]).toMatchObject({ oldStart: 6, oldCount: 1, oldLines: ["6"], newLines: ["SIX"] });
  });

  it("parses a pure insertion (-N,0) mid-file", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n3\n" });
    writeFiles(repo, { "a.txt": "1\n2\nNEW\n3\n" });
    const { hunks } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 2, oldCount: 0, newStart: 3, newCount: 1, oldLines: [], newLines: ["NEW"] });
  });

  it("parses a pure insertion before the first line (-0,0)", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n" });
    writeFiles(repo, { "a.txt": "NEW\n1\n2\n" });
    const { hunks } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, oldLines: [], newLines: ["NEW"] });
  });

  it("parses a pure deletion", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n3\n" });
    writeFiles(repo, { "a.txt": "1\n3\n" });
    const { hunks } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 2, oldCount: 1, newStart: 1, newCount: 0, oldLines: ["2"], newLines: [] });
  });

  it("handles a file with no trailing newline", () => {
    repo = makeFixtureRepo({ "a.txt": "one\ntwo" }); // no trailing \n
    writeFiles(repo, { "a.txt": "one\nTWO" });
    const { hunks } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(hunks).toHaveLength(1);
    // The "\ No newline at end of file" marker line must not leak into oldLines/newLines.
    expect(hunks[0].oldLines).toEqual(["two"]);
    expect(hunks[0].newLines).toEqual(["TWO"]);
  });
});

describe("parseUnifiedDiff — whole-file changes", () => {
  it("flags a new file as kind 'add', with hunks covering its content", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n" });
    writeFiles(repo, { "b.txt": "new file content\n" });
    git(["add", "-A"], repo); // untracked files need staging to appear in `git diff HEAD`
    const { hunks, files } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(files).toContainEqual({ file: "b.txt", kind: "add" });
    expect(hunks.find((h) => h.file === "b.txt")).toMatchObject({ oldStart: 0, oldCount: 0 });
  });

  it("flags a deleted file as kind 'delete'", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n" });
    fs_unlink(repo, "a.txt");
    const { files, hunks } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(files).toContainEqual({ file: "a.txt", kind: "delete" });
    expect(hunks.find((h) => h.file === "a.txt")).toMatchObject({ newStart: 0, newCount: 0 });
  });

  it("flags a binary file change as kind 'binary' with zero hunks", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n" });
    fs.writeFileSync(`${repo}/img.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    git(["add", "-A"], repo);
    const { files, hunks } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(files).toContainEqual({ file: "img.png", kind: "binary" });
    expect(hunks.filter((h) => h.file === "img.png")).toHaveLength(0);
  });

  it("flags a pure file-mode-only change (chmod, no content edit) as kind 'mode' with zero hunks", () => {
    // Regression test for blocker #4/finding #7: a mode-only diff section has
    // no "---"/"+++"/hunk lines at all (only "old mode"/"new mode"), so
    // without explicit tracking it was previously either dropped entirely or
    // (after the diff --git header fallback) misclassified as "modify" even
    // though nothing about the file's content changed.
    repo = makeFixtureRepo({ "script.sh": "line1\nline2\n" });
    fs.chmodSync(`${repo}/script.sh`, 0o755);
    const { files, hunks } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(files).toContainEqual({ file: "script.sh", kind: "mode" });
    expect(hunks.filter((h) => h.file === "script.sh")).toHaveLength(0);
  });

  it("still flags kind 'modify' (not 'mode') when a mode change accompanies a real content edit", () => {
    repo = makeFixtureRepo({ "script.sh": "line1\nline2\n" });
    fs.chmodSync(`${repo}/script.sh`, 0o755);
    writeFiles(repo, { "script.sh": "line1\nCHANGED\n" });
    const { files, hunks } = parseUnifiedDiff(diffHeadToWorktree(repo));
    expect(files).toContainEqual({ file: "script.sh", kind: "modify" });
    expect(hunks.filter((h) => h.file === "script.sh")).toHaveLength(1);
  });

  it("flags a rename (with content unchanged) as kind 'rename' with oldFile set", () => {
    repo = makeFixtureRepo({ "old.txt": "same content that is long enough to trigger rename detection\n" });
    git(["mv", "old.txt", "new.txt"], repo);
    const raw = git(["diff", "-U0", "--no-color", "-M", "HEAD"], repo);
    const { files } = parseUnifiedDiff(raw);
    expect(files).toContainEqual({ file: "new.txt", oldFile: "old.txt", kind: "rename" });
  });
});

function fs_unlink(repo, rel) {
  fs.unlinkSync(`${repo}/${rel}`);
}

describe("hunkKey / subtractHunks", () => {
  it("does not collide for two different hunks whose fields' naive space-joined concatenation would coincide (finding #5 regression)", () => {
    // A naive `[file, oldStart, oldCount, oldLines.join("\n"), newLines.join("\n")].join(" ")`
    // key is ambiguous: a space embedded in a line's own content can redistribute
    // across the "boundary" between oldLines and newLines and still produce the
    // identical joined string for two genuinely different hunks.
    const a = { file: "a", oldStart: 1, oldCount: 1, oldLines: ["b c"], newLines: ["d"] };
    const b = { file: "a", oldStart: 1, oldCount: 1, oldLines: ["b"], newLines: ["c d"] };
    // Both would naively join to the identical string "a 1 1 b c d".
    expect(["a", 1, 1, "b c", "d"].join(" ")).toBe(["a", 1, 1, "b", "c d"].join(" "));
    expect(hunkKey(a)).not.toBe(hunkKey(b));
  });

  it("gives identical hunks (from independent parses) the same key", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n3\n" });
    writeFiles(repo, { "a.txt": "1\nTWO\n3\n" });
    const first = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks;
    const second = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks;
    expect(hunkKey(first[0])).toBe(hunkKey(second[0]));
  });

  it("subtracts identical hunk sets to empty (HEAD..S0 is empty by construction)", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n" });
    const { hunks } = parseUnifiedDiff(diffHeadToWorktree(repo)); // clean tree: no diff, no hunks
    expect(subtractHunks(hunks, hunks)).toEqual([]);
    expect(hunks).toEqual([]);
  });

  it("subtraction returns only the hunks newly introduced since a prior capture", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n3\n" });
    writeFiles(repo, { "a.txt": "ONE\n2\n3\n" });
    const afterFirstEdit = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks;

    writeFiles(repo, { "a.txt": "ONE\n2\nTHREE\n" });
    const afterSecondEdit = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks;

    const fresh = subtractHunks(afterSecondEdit, afterFirstEdit);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ oldStart: 3, oldLines: ["3"], newLines: ["THREE"] });
  });

  it("subtraction re-includes a hunk whose content changed again at the same location", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n3\n" });
    writeFiles(repo, { "a.txt": "ONE\n2\n3\n" });
    const afterFirstEdit = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks;

    writeFiles(repo, { "a.txt": "UNO\n2\n3\n" }); // same region, different text — old key no longer matches
    const afterSecondEdit = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks;

    const fresh = subtractHunks(afterSecondEdit, afterFirstEdit);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].newLines).toEqual(["UNO"]);
  });
});

describe("oldRangesOverlap", () => {
  it("treats different files as never overlapping", () => {
    const a = { file: "a.txt", oldStart: 1, oldCount: 1 };
    const b = { file: "b.txt", oldStart: 1, oldCount: 1 };
    expect(oldRangesOverlap(a, b)).toBe(false);
  });

  it("detects overlapping old-side ranges in the same file", () => {
    const a = { file: "a.txt", oldStart: 5, oldCount: 3 }; // lines 5-7
    const b = { file: "a.txt", oldStart: 7, oldCount: 2 }; // lines 7-8
    expect(oldRangesOverlap(a, b)).toBe(true);
  });

  it("does not overlap disjoint ranges", () => {
    const a = { file: "a.txt", oldStart: 5, oldCount: 3 }; // lines 5-7
    const b = { file: "a.txt", oldStart: 10, oldCount: 2 }; // lines 10-11
    expect(oldRangesOverlap(a, b)).toBe(false);
  });

  it("treats pure-insertion hunks (oldCount 0) as covering one anchor line for overlap purposes", () => {
    const insertion = { file: "a.txt", oldStart: 5, oldCount: 0 };
    const sameLine = { file: "a.txt", oldStart: 5, oldCount: 1 };
    expect(oldRangesOverlap(insertion, sameLine)).toBe(true);
  });
});

describe("parseHunks (GitHub REST patch text)", () => {
  it("extracts new-side (RIGHT) ranges, defaulting an omitted count to 1", () => {
    const patch = "@@ -1,2 +1,3 @@\n-a\n+a\n+b\n+c\n@@ -10 +11 @@\n-x\n+y\n";
    expect(parseHunks(patch)).toEqual([
      { startLine: 1, endLine: 3 },
      { startLine: 11, endLine: 11 },
    ]);
  });

  it("skips a hunk that is a pure deletion on the right (+N,0)", () => {
    const patch = "@@ -5,3 +5,0 @@\n-a\n-b\n-c\n";
    expect(parseHunks(patch)).toEqual([]);
  });

  it("returns an empty array for empty/missing patch text", () => {
    expect(parseHunks("")).toEqual([]);
    expect(parseHunks(undefined)).toEqual([]);
  });
});

describe("resolveHunkSurvival", () => {
  it("recognizes a hunk that survives verbatim (exact match)", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n3\n" });
    writeFiles(repo, { "a.txt": "1\nTWO\n3\n" });
    const captured = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks[0];
    const current = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks; // same edit, re-diffed
    expect(resolveHunkSurvival(captured, current).survived).toBe(true);
  });

  it("recognizes survival when an unrelated edit is inserted immediately AFTER the captured line (git merges them into one hunk)", () => {
    // Regression test for blocker #2: a previously-captured 1-line fix must
    // not be reported as "vanished" just because git's -U0 diff merges it
    // with a zero-gap adjacent insertion into a single hunk.
    repo = makeFixtureRepo(
      Object.fromEntries([["f.txt", Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n"]]),
    );
    writeFiles(repo, { "f.txt": Array.from({ length: 10 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`)).join("\n") + "\n" });
    const captured = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks[0];
    expect(captured).toMatchObject({ oldStart: 10, oldCount: 1, oldLines: ["line10"], newLines: ["line10 FIXED"] });

    // A second, unrelated edit inserts two new lines immediately after line 10.
    const lines = Array.from({ length: 10 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`));
    lines.splice(10, 0, "NEWLINE1", "NEWLINE2");
    writeFiles(repo, { "f.txt": lines.join("\n") + "\n" });
    const current = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks;
    expect(current).toHaveLength(1); // confirms git merged them into one hunk
    expect(current[0].newLines).toEqual(["line10 FIXED", "NEWLINE1", "NEWLINE2"]);

    expect(resolveHunkSurvival(captured, current).survived).toBe(true);
  });

  it("recognizes survival when an unrelated edit is inserted immediately BEFORE the captured line", () => {
    repo = makeFixtureRepo(
      Object.fromEntries([["f.txt", Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n"]]),
    );
    writeFiles(repo, { "f.txt": Array.from({ length: 10 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`)).join("\n") + "\n" });
    const captured = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks[0];

    const lines = Array.from({ length: 10 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`));
    lines.splice(9, 0, "NEWBEFORE1", "NEWBEFORE2");
    writeFiles(repo, { "f.txt": lines.join("\n") + "\n" });
    const current = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks;
    expect(current).toHaveLength(1);

    expect(resolveHunkSurvival(captured, current).survived).toBe(true);
  });

  it("still stays as two separate hunks (no merge) with a genuine 1-line gap — behavior unchanged", () => {
    repo = makeFixtureRepo(
      Object.fromEntries([["f.txt", Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n") + "\n"]]),
    );
    writeFiles(repo, {
      "f.txt": Array.from({ length: 20 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`)).join("\n") + "\n",
    });
    const captured = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks[0];

    const lines = Array.from({ length: 20 }, (_, i) => (i === 9 ? "line10 FIXED" : `line${i + 1}`));
    lines.splice(11, 0, "NEWGAP1"); // inserted after line 12, leaving line 11 as an untouched 1-line gap
    writeFiles(repo, { "f.txt": lines.join("\n") + "\n" });
    const current = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks;
    expect(current).toHaveLength(2); // confirms NOT merged — a genuine gap stays two hunks

    expect(resolveHunkSurvival(captured, current).survived).toBe(true); // the fix's own hunk is still exactly present
  });

  it("correctly reports non-survival (negative) when the captured region is genuinely overwritten again", () => {
    repo = makeFixtureRepo({ "f.txt": "1\n2\n3\n" });
    writeFiles(repo, { "f.txt": "1\nTWO\n3\n" });
    const captured = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks[0];

    writeFiles(repo, { "f.txt": "1\nDIFFERENT\n3\n" }); // same line, different content — genuinely overwritten
    const current = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks;

    expect(resolveHunkSurvival(captured, current).survived).toBe(false);
  });

  it("recognizes survival across a rename, given the rename map (negative without it)", () => {
    repo = makeFixtureRepo({ "old.txt": "1\n2\n3\n" });
    writeFiles(repo, { "old.txt": "1\nTWO\n3\n" });
    const captured = parseUnifiedDiff(diffHeadToWorktree(repo)).hunks[0];
    expect(captured.file).toBe("old.txt");

    git(["add", "-A"], repo);
    git(["commit", "-q", "-m", "commit the fix so the rename below has content to move"], repo);
    // Recompute "captured" as it would be recorded against the ORIGINAL HEAD (still old.txt) —
    // simulate by keeping the same object; only the live tree is renamed below.
    git(["mv", "old.txt", "new.txt"], repo);
    const raw = git(["diff", "-U0", "--no-color", "-M", "HEAD~1"], repo);
    const { hunks: current, files } = parseUnifiedDiff(raw);
    const renameMap = buildRenameMap(files);
    expect(renameMap.get("old.txt")).toBe("new.txt");

    expect(resolveHunkSurvival(captured, current).survived).toBe(false); // without remapping, file names don't match
    expect(resolveHunkSurvival(captured, current, renameMap).survived).toBe(true); // with remapping, recognized
  });
});

describe("buildRenameMap", () => {
  it("maps oldFile to file for rename entries only", () => {
    const files = [
      { file: "new.txt", oldFile: "old.txt", kind: "rename" },
      { file: "b.txt", kind: "modify" },
      { file: "c.txt", kind: "add" },
    ];
    const map = buildRenameMap(files);
    expect(map.get("old.txt")).toBe("new.txt");
    expect(map.size).toBe(1);
  });

  it("returns an empty map for no renames (negative)", () => {
    expect(buildRenameMap([{ file: "a.txt", kind: "modify" }]).size).toBe(0);
    expect(buildRenameMap([]).size).toBe(0);
    expect(buildRenameMap(undefined).size).toBe(0);
  });
});

describe("rangeContains", () => {
  const ranges = [
    { startLine: 10, endLine: 20 },
    { startLine: 40, endLine: 40 },
  ];

  it("accepts a range fully inside one of the ranges", () => {
    expect(rangeContains(ranges, 12, 15)).toBe(true);
    expect(rangeContains(ranges, 40, 40)).toBe(true);
  });

  it("rejects a range only partially inside a diff range", () => {
    expect(rangeContains(ranges, 18, 25)).toBe(false);
  });

  it("rejects a range entirely outside every diff range", () => {
    expect(rangeContains(ranges, 100, 105)).toBe(false);
  });
});
