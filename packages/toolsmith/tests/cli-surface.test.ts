/**
 * UAT for the CLI's verb surface and help/error contract, driven through the
 * real bundle as a user would invoke it.
 *
 * Verb set is canon: approve / lint / list / analyze (+ verify) —
 * docs/toolsmith/cli-surface.md §Verbs; `new`/`modify` are deliberately not
 * verbs.
 */
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTmpDirs, newHome, newProj, runCli } from "./helpers.js";

afterAll(cleanupTmpDirs);

describe("toolsmith --help", () => {
  it("prints usage and exits 0", () => {
    const r = runCli(["--help"], { proj: newProj(), home: newHome() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("toolsmith approve <path>");
    expect(r.stdout).toContain("toolsmith lint");
    expect(r.stdout).toContain("toolsmith list");
    expect(r.stdout).toContain("toolsmith analyze");
  });

  it("bare invocation prints usage and exits non-zero", () => {
    const r = runCli([], { proj: newProj(), home: newHome() });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Usage:");
  });

  it("unknown verb errors with usage on stderr", () => {
    const r = runCli(["frobnicate"], { proj: newProj(), home: newHome() });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown verb "frobnicate"');
  });

  it("authoring is not a verb: `new` and `modify` are rejected", () => {
    for (const verb of ["new", "modify"]) {
      const r = runCli([verb], { proj: newProj(), home: newHome() });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`unknown verb "${verb}"`);
    }
  });

  it("approve --help is written for the human running the commit", () => {
    const r = runCli(["approve", "--help"], { proj: newProj(), home: newHome() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("You are the human in this handshake");
    expect(r.stdout).toContain("--dry-run");
    expect(r.stdout).toContain("review surface");
  });

  it("approve without a path fails with help", () => {
    const r = runCli(["approve"], { proj: newProj(), home: newHome() });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("expected exactly one <path> argument");
  });
});
