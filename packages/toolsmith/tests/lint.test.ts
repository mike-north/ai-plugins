/**
 * `toolsmith lint` — the proposal gate. Errors block (and the identical error
 * set blocks `approve`); warnings don't. See
 * docs/toolsmith/cli-surface.md §Verbs and docs/toolsmith/lint-rule-concepts.md
 * (forge rule pack pending eslint-sh, reported as such).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTmpDirs, makeTmpDir, newHome, newProj, runCli } from "./helpers.js";

afterAll(cleanupTmpDirs);

function lintFile(content: string): { status: number; stdout: string; stderr: string } {
  const dir = makeTmpDir("toolsmith-lint-");
  const file = join(dir, "draft");
  writeFileSync(file, content);
  return runCli(["lint", file], { proj: newProj(), home: newHome() });
}

describe("toolsmith lint", () => {
  it("passes a clean bash script", () => {
    const r = lintFile('#!/bin/bash\nset -euo pipefail\necho "hello"\n');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PASS");
  });

  it("fails on a bash syntax error", () => {
    const r = lintFile('#!/bin/bash\nif [ x; then\n');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("bash-syntax");
    expect(r.stdout).toContain("FAIL");
  });

  it("fails on an empty draft", () => {
    const r = lintFile("");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("non-empty");
  });

  it("fails on binary content (NUL bytes)", () => {
    const dir = makeTmpDir("toolsmith-lint-bin-");
    const file = join(dir, "draft");
    writeFileSync(file, Buffer.from([0x23, 0x21, 0x00, 0x01]));
    const r = runCli(["lint", file], { proj: newProj(), home: newHome() });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("text-script");
  });

  it("warns (but passes) on a missing shebang", () => {
    const r = lintFile('echo "no shebang"\n');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("warning shebang");
  });

  it("warns on interactive prompts (design-patterns.md rejects interactivity)", () => {
    const r = lintFile('#!/bin/bash\nread -p "Continue? " ans\n');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no-interactivity");
  });

  it("warns on secret-bearing flags", () => {
    const r = lintFile('#!/bin/bash\ncurl --token abc https://example.com\n');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no-secret-flags");
  });

  it("reports the forge rule pack as pending, never silently implied to run", () => {
    const r = lintFile('#!/bin/bash\necho ok\n');
    expect(r.stdout).toContain("pending (forge rule pack, awaiting eslint-sh)");
    expect(r.stdout).toContain("contract-header-present");
  });

  it("errors on a missing file", () => {
    const r = runCli(["lint", "/nonexistent/path/draft"], { proj: newProj(), home: newHome() });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does not exist");
  });
});
