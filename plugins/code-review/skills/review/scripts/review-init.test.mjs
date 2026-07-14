/**
 * Tests for review-init.mjs — session start: clean-worktree assertion,
 * baseline capture, S0 snapshot, and state.json persistence.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reviewInit } from "./review-init.mjs";
import { readState } from "./lib/snapshot.mjs";
import { makeFixtureRepo, removeDir, tempDir, writeFiles } from "./test-support/git-fixture.mjs";

let repo;
let workArea;

afterEach(() => {
  if (repo) removeDir(repo);
  if (workArea) removeDir(workArea);
  repo = undefined;
  workArea = undefined;
});

describe("reviewInit", () => {
  it("initializes state.json with headSha, baselineTree, branch, and an S0 snapshot", () => {
    repo = makeFixtureRepo({ "a.ts": "export const x = 1;\n" });
    workArea = tempDir("cr-wa-");

    const out = reviewInit({ workArea, worktree: repo });
    expect(out.workArea).toBe(path.resolve(workArea));
    expect(out.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(out.baselineTree).toMatch(/^[0-9a-f]{40}$/);

    const state = readState(workArea);
    expect(state.worktree).toBe(path.resolve(repo));
    expect(state.headSha).toBe(out.headSha);
    expect(state.baselineTree).toBe(out.baselineTree);
    expect(state.branch).toBe("main");
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0].seq).toBe(0);
    expect(state.reviewerSeq).toEqual({});
    expect(state.findings).toEqual({});
    expect(fs.existsSync(path.join(workArea, "findings"))).toBe(true);
  });

  it("derives repositoryUri from --repo/--host and records repo/pr", () => {
    repo = makeFixtureRepo({ "a.ts": "1\n" });
    workArea = tempDir("cr-wa-");
    reviewInit({ workArea, worktree: repo, repo: "acme/widgets", pr: 42, host: "git.corp.example.com" });
    const state = readState(workArea);
    expect(state.repositoryUri).toBe("https://git.corp.example.com/acme/widgets");
    expect(state.repo).toBe("acme/widgets");
    expect(state.pr).toBe(42);
  });

  it("defaults host to github.com when --repo is given without --host", () => {
    repo = makeFixtureRepo({ "a.ts": "1\n" });
    workArea = tempDir("cr-wa-");
    reviewInit({ workArea, worktree: repo, repo: "acme/widgets" });
    expect(readState(workArea).repositoryUri).toBe("https://github.com/acme/widgets");
  });

  it("rejects a dirty worktree", () => {
    repo = makeFixtureRepo({ "a.ts": "1\n" });
    workArea = tempDir("cr-wa-");
    writeFiles(repo, { "a.ts": "2\n" }); // uncommitted edit
    expect(() => reviewInit({ workArea, worktree: repo })).toThrow(/not clean/);
  });

  it("rejects a worktree with an untracked file", () => {
    repo = makeFixtureRepo({ "a.ts": "1\n" });
    workArea = tempDir("cr-wa-");
    writeFiles(repo, { "untracked.ts": "x\n" });
    expect(() => reviewInit({ workArea, worktree: repo })).toThrow(/not clean/);
  });

  it("rejects missing --work-area / --worktree", () => {
    repo = makeFixtureRepo({ "a.ts": "1\n" });
    expect(() => reviewInit({ worktree: repo })).toThrow(/work-area/);
    expect(() => reviewInit({ workArea: "/tmp/x" })).toThrow(/worktree/);
  });

  it("rejects a non-integer --pr", () => {
    repo = makeFixtureRepo({ "a.ts": "1\n" });
    workArea = tempDir("cr-wa-");
    expect(() => reviewInit({ workArea, worktree: repo, pr: 4.5 })).toThrow(/--pr/);
  });
});
