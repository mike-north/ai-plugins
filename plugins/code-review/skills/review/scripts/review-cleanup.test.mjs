/**
 * Tests for review-cleanup.mjs: snapshot ref / tmp-index / lock removal.
 * Cleanup deliberately does NOT remove the work-area directory itself
 * (state.json and findings/ are left for inspection) nor the git worktree.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit, readState } from "./lib/snapshot.mjs";
import { reviewCleanup } from "./review-cleanup.mjs";
import { reviewInit } from "./review-init.mjs";
import { makeFixtureRepo, removeDir } from "./test-support/git-fixture.mjs";

let repo;
let workArea;

afterEach(() => {
  if (repo) removeDir(repo);
  if (workArea) removeDir(workArea);
  repo = undefined;
  workArea = undefined;
});

describe("reviewCleanup", () => {
  it("deletes the work area's snapshot refs but leaves state.json and findings/ in place", () => {
    repo = makeFixtureRepo({ "a.ts": "1\n" });
    workArea = `${repo}-wa`;
    reviewInit({ workArea, worktree: repo });
    const state = readState(workArea);

    const before = execGit(["for-each-ref", `refs/code-review/${state.workAreaId}`], { cwd: repo });
    expect(before.trim()).not.toBe("");

    const out = reviewCleanup({ workArea });
    expect(out.workArea).toBe(path.resolve(workArea));

    const after = execGit(["for-each-ref", `refs/code-review/${state.workAreaId}`], { cwd: repo });
    expect(after.trim()).toBe("");
    expect(fs.existsSync(path.join(workArea, "state.json"))).toBe(true);
    expect(fs.existsSync(path.join(workArea, "findings"))).toBe(true);
  });

  it("removes the tmp-index and lock directory if present", () => {
    repo = makeFixtureRepo({ "a.ts": "1\n" });
    workArea = `${repo}-wa`;
    reviewInit({ workArea, worktree: repo });
    fs.writeFileSync(path.join(workArea, "tmp-index"), "stale");
    fs.mkdirSync(path.join(workArea, "state.lock"));

    reviewCleanup({ workArea });

    expect(fs.existsSync(path.join(workArea, "tmp-index"))).toBe(false);
    expect(fs.existsSync(path.join(workArea, "state.lock"))).toBe(false);
  });

  it("rejects a missing --work-area", () => {
    expect(() => reviewCleanup({})).toThrow(/work-area/);
  });

  it("throws for an uninitialized work area", () => {
    const neverCreated = path.join(os.tmpdir(), "cr-review-cleanup-uninitialized-fixture");
    expect(fs.existsSync(neverCreated)).toBe(false); // guard: this path must genuinely not exist
    expect(() => reviewCleanup({ workArea: neverCreated })).toThrow(/not initialized/);
  });
});
