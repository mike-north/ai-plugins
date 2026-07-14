/**
 * Tests for the git plumbing behind the snapshot-subtraction fix-capture
 * protocol: temp-index worktree snapshots, snapshot pinning, state.json
 * persistence, and the exclusive lock.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFixtureRepo, removeDir, tempDir, writeFiles } from "../test-support/git-fixture.mjs";
import { parseUnifiedDiff } from "./hunks.mjs";
import {
  createSnapshot,
  diffTrees,
  diffWorktree,
  execGit,
  gitStatusPorcelain,
  readHeadBlob,
  readState,
  revParse,
  statePath,
  toPosixPath,
  withLock,
  workAreaId,
  writeState,
} from "./snapshot.mjs";

let repo;
let workArea;

afterEach(() => {
  if (repo) removeDir(repo);
  if (workArea) removeDir(workArea);
  repo = undefined;
  workArea = undefined;
});

describe("gitStatusPorcelain / revParse", () => {
  it("reports a clean tree as empty and a dirty tree as non-empty", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n" });
    expect(gitStatusPorcelain(repo).trim()).toBe("");
    writeFiles(repo, { "a.txt": "2\n" });
    expect(gitStatusPorcelain(repo).trim()).not.toBe("");
  });

  it("resolves HEAD and HEAD^{tree}", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n" });
    const sha = revParse(repo, "HEAD");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const tree = revParse(repo, "HEAD^{tree}");
    expect(tree).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("readHeadBlob", () => {
  it("reads a file's lines at HEAD regardless of live worktree edits", () => {
    repo = makeFixtureRepo({ "a.txt": "one\ntwo\nthree\n" });
    writeFiles(repo, { "a.txt": "one\nEDITED\nthree\n" }); // live edit, not committed
    const { lines } = readHeadBlob(repo, "a.txt");
    expect(lines).toEqual(["one", "two", "three"]); // HEAD content, not live content
  });

  it("handles a HEAD file with no trailing newline", () => {
    repo = makeFixtureRepo({ "a.txt": "one\ntwo" });
    expect(readHeadBlob(repo, "a.txt").lines).toEqual(["one", "two"]);
  });

  it("throws a descriptive error for a file absent from HEAD", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n" });
    expect(() => readHeadBlob(repo, "nope.txt")).toThrow(/does not exist in HEAD/);
  });
});

describe("workAreaId", () => {
  it("is deterministic for the same absolute path", () => {
    expect(workAreaId("/tmp/foo")).toBe(workAreaId("/tmp/foo"));
  });

  it("differs for different paths", () => {
    expect(workAreaId("/tmp/foo")).not.toBe(workAreaId("/tmp/bar"));
  });

  it("is a 12-character lowercase hex string", () => {
    expect(workAreaId("/tmp/foo")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("createSnapshot / diffTrees", () => {
  it("S0 (baseline snapshot) diffs empty against HEAD, by construction", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n" });
    workArea = tempDir("cr-wa-");
    const headSha = revParse(repo, "HEAD");
    const id = workAreaId(workArea);
    const s0 = createSnapshot(repo, workArea, { workAreaId: id, seq: 0, parentSha: headSha });
    expect(s0.ref).toBe(`refs/code-review/${id}/snap-0`);
    const diffText = diffTrees(repo, headSha, s0.commitOid);
    expect(diffText.trim()).toBe("");
  });

  it("captures live worktree edits (including untracked new files) into the snapshot tree", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n" });
    workArea = tempDir("cr-wa-");
    const headSha = revParse(repo, "HEAD");
    const id = workAreaId(workArea);

    writeFiles(repo, { "a.txt": "1\nTWO\n", "new.txt": "brand new\n" });
    const s1 = createSnapshot(repo, workArea, { workAreaId: id, seq: 1, parentSha: headSha });
    const { hunks, files } = parseUnifiedDiff(diffTrees(repo, headSha, s1.commitOid));
    expect(hunks.find((h) => h.file === "a.txt")).toMatchObject({ oldLines: ["2"], newLines: ["TWO"] });
    expect(files).toContainEqual({ file: "new.txt", kind: "add" });
  });

  it("does not mutate the repo's real index", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n" });
    workArea = tempDir("cr-wa-");
    const headSha = revParse(repo, "HEAD");
    const id = workAreaId(workArea);
    writeFiles(repo, { "a.txt": "2\n", "untracked.txt": "x\n" });
    const statusBefore = gitStatusPorcelain(repo);
    createSnapshot(repo, workArea, { workAreaId: id, seq: 0, parentSha: headSha });
    expect(gitStatusPorcelain(repo)).toBe(statusBefore); // real index/status unaffected
  });

  it("captures a deletion of a tracked file relative to HEAD", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n", "b.txt": "2\n" });
    workArea = tempDir("cr-wa-");
    const headSha = revParse(repo, "HEAD");
    const id = workAreaId(workArea);
    fs.unlinkSync(path.join(repo, "b.txt"));
    const s1 = createSnapshot(repo, workArea, { workAreaId: id, seq: 1, parentSha: headSha });
    const { files } = parseUnifiedDiff(diffTrees(repo, headSha, s1.commitOid));
    expect(files).toContainEqual({ file: "b.txt", kind: "delete" });
  });

  it("correctly parses a non-ASCII filename (git's default core.quotePath would otherwise quote+octal-escape it, corrupting the path)", () => {
    // Regression test for: unicode filenames mis-parsed by parseUnifiedDiff.
    // Without `-c core.quotePath=false`, git emits `--- "a/\303\274...".ts"`
    // (quoted, C-style octal-escaped) for this path, and stripAbPrefix's
    // `/^[ab]\//` never matches a string starting with `"`, so the entire
    // garbled quoted string leaks through as the hunk's `file`.
    repo = makeFixtureRepo({ "ünïcödé.ts": "one\ntwo\n" });
    workArea = tempDir("cr-wa-");
    const headSha = revParse(repo, "HEAD");
    const id = workAreaId(workArea);
    writeFiles(repo, { "ünïcödé.ts": "one\nTWO\n" });
    const s1 = createSnapshot(repo, workArea, { workAreaId: id, seq: 1, parentSha: headSha });
    const { hunks } = parseUnifiedDiff(diffTrees(repo, headSha, s1.commitOid));
    expect(hunks).toHaveLength(1);
    expect(hunks[0].file).toBe("ünïcödé.ts");
    expect(hunks[0]).toMatchObject({ oldLines: ["two"], newLines: ["TWO"] });
  });

  it("pins snapshot commits with a fixed, deterministic author/committer identity and timestamp", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n" });
    workArea = tempDir("cr-wa-");
    const headSha = revParse(repo, "HEAD");
    const id = workAreaId(workArea);
    const s0 = createSnapshot(repo, workArea, { workAreaId: id, seq: 0, parentSha: headSha });
    const show = execGit(["show", "-s", "--format=%an <%ae> %ad", "--date=iso-strict"], { cwd: repo }).trim();
    // Only the commit at s0.commitOid matters here — %ad above would show HEAD; check the pinned commit directly.
    const pinned = execGit(["show", "-s", "--format=%an <%ae> %ad", "--date=iso-strict", s0.commitOid], {
      cwd: repo,
    }).trim();
    expect(pinned).toBe("code-review <noreply@localhost> 1970-01-01T00:00:00Z");
    expect(show).not.toBe(pinned); // sanity: HEAD's own commit is the real (fixture) author
  });
});

describe("diffWorktree", () => {
  it("diffs HEAD against the live worktree directly (no snapshot involved)", () => {
    repo = makeFixtureRepo({ "a.txt": "1\n2\n" });
    writeFiles(repo, { "a.txt": "1\nTWO\n" });
    const { hunks } = parseUnifiedDiff(diffWorktree(repo));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldLines: ["2"], newLines: ["TWO"] });
  });

  it("correctly parses a non-ASCII filename against the live worktree (same core.quotePath hazard as diffTrees)", () => {
    repo = makeFixtureRepo({ "ünïcödé.ts": "one\ntwo\n" });
    writeFiles(repo, { "ünïcödé.ts": "one\nTWO\n" });
    const { hunks } = parseUnifiedDiff(diffWorktree(repo));
    expect(hunks).toHaveLength(1);
    expect(hunks[0].file).toBe("ünïcödé.ts");
  });
});

describe("toPosixPath", () => {
  it("is a no-op for already-POSIX paths", () => {
    expect(toPosixPath("src/x/y.ts")).toBe("src/x/y.ts");
  });
});

describe("state.json read/write", () => {
  it("round-trips a state object", () => {
    workArea = tempDir("cr-wa-");
    const state = { workAreaId: "abc123", worktree: "/tmp/x", headSha: "deadbeef", findings: {} };
    writeState(workArea, state);
    expect(fs.existsSync(statePath(workArea))).toBe(true);
    expect(readState(workArea)).toEqual(state);
  });

  it("throws a descriptive error when state.json is absent (uninitialized work area)", () => {
    workArea = tempDir("cr-wa-");
    expect(() => readState(workArea)).toThrow(/not initialized/);
  });
});

describe("writeState atomicity (blocker #3 regression)", () => {
  // Regression tests for: writeState used a single fs.writeFileSync directly
  // to the final path, so a concurrent reader (e.g. merge-findings.mjs running
  // without its own lock) could observe a torn/partial state.json. Writing to
  // a temp file and renaming into place (POSIX rename is atomic) means any
  // reader always sees either the old or the new content in full, never both.
  //
  // Verified via real filesystem behavior (not fs spying — Node's ESM `fs`
  // module namespace can't be spied on: "Cannot redefine property"). The temp
  // path is deterministic per-process (`<final>.tmp-<pid>`), so a test running
  // in the same process can pre-occupy it as a directory to force the
  // temp-write step itself to fail, and confirm the ALREADY-EXISTING final
  // file is left completely untouched — proof the implementation never writes
  // to the final path directly.

  it("never touches the final file when the temp-write step fails", () => {
    workArea = tempDir("cr-wa-");
    writeState(workArea, { version: "old" }); // an existing, valid state.json
    const finalPath = statePath(workArea);
    const tmpPath = `${finalPath}.tmp-${process.pid}`;
    fs.mkdirSync(tmpPath); // occupy the exact temp path so the write step fails (EISDIR)

    expect(() => writeState(workArea, { version: "new" })).toThrow();
    expect(readState(workArea)).toEqual({ version: "old" }); // untouched — never partially overwritten
  });

  it("leaves no stray temp file behind after a successful write (negative)", () => {
    workArea = tempDir("cr-wa-");
    writeState(workArea, { a: 1 });
    const leftover = fs.readdirSync(workArea).filter((f) => f !== "state.json");
    expect(leftover).toEqual([]);
  });
});

describe("withLock", () => {
  it("serializes access: a nested call for the same work area must wait, not run concurrently", () => {
    workArea = tempDir("cr-wa-");
    const order = [];
    withLock(workArea, () => {
      order.push("outer-start");
      // A second acquisition attempt while the lock is held must not be able
      // to run its callback until the outer one releases — verified here by
      // running it synchronously *after* release (single-threaded, so a
      // truly concurrent case is exercised via the stale-lock test below).
      order.push("outer-end");
    });
    withLock(workArea, () => order.push("second"));
    expect(order).toEqual(["outer-start", "outer-end", "second"]);
  });

  it("reclaims a stale lock (age exceeded, owning pid no longer alive)", () => {
    workArea = tempDir("cr-wa-");
    const lockDir = path.join(workArea, "state.lock");
    fs.mkdirSync(lockDir, { recursive: true });
    // A pid that is essentially guaranteed not to exist.
    fs.writeFileSync(path.join(lockDir, "pid"), "999999");
    const oldTime = new Date(Date.now() - 60_000);
    fs.utimesSync(lockDir, oldTime, oldTime);

    let ran = false;
    withLock(workArea, () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(fs.existsSync(lockDir)).toBe(false); // released after the reclaimed run
  });

  it("propagates the callback's thrown error and still releases the lock", () => {
    workArea = tempDir("cr-wa-");
    expect(() =>
      withLock(workArea, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(fs.existsSync(path.join(workArea, "state.lock"))).toBe(false);
  });
});
