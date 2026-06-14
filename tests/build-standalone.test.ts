/**
 * Tests for the standalone-export copy boundary in src/build-standalone.ts.
 *
 * Regression guard: build:standalone copies plugin source (notably `skills/`)
 * into `dist/`. Before the fix it copied directories wholesale, so a test file
 * colocated inside a skill (e.g. `scripts/foo.test.mjs` next to `foo.mjs`) was
 * shipped into every standalone export — and, for a runner that auto-discovers
 * tests, executed redundantly from the copies. `isDistributable` must exclude
 * test/spec sources and test directories from every copy.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isDistributable, copyDir } from "../src/build-standalone.js";

describe("isDistributable", () => {
  it("accepts ordinary shipped files and directories", () => {
    for (const name of ["SKILL.md", "manifest.mjs", "foo.mjs", "README.md", "scripts", "reference"]) {
      expect(isDistributable(name)).toBe(true);
    }
  });

  it("rejects *.test.* sources across JS/TS extensions (negative)", () => {
    for (const name of [
      "manifest.test.mjs",
      "foo.test.js",
      "foo.test.cjs",
      "foo.test.ts",
      "foo.test.mts",
      "foo.test.tsx",
    ]) {
      expect(isDistributable(name)).toBe(false);
    }
  });

  it("rejects *.spec.* sources (negative)", () => {
    for (const name of ["foo.spec.mjs", "foo.spec.ts", "foo.spec.jsx"]) {
      expect(isDistributable(name)).toBe(false);
    }
  });

  it("rejects conventional test/cache directories (negative)", () => {
    expect(isDistributable("__tests__")).toBe(false);
    expect(isDistributable("node_modules")).toBe(false);
  });

  it("does not over-match files that merely contain 'test' (negative)", () => {
    // These are real, shippable content — only the *.test.*/*.spec.* shape is excluded.
    for (const name of ["test-helpers.md", "latest.mjs", "contest.md", "testing.md"]) {
      expect(isDistributable(name)).toBe(true);
    }
  });
});

describe("copyDir excludes test artifacts end-to-end", () => {
  /** @type {string} */
  let src: string;
  /** @type {string} */
  let dest: string;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), "build-standalone-"));
    src = join(base, "skills");
    dest = join(base, "dist");
    // A skill with a colocated script + its test, plus a __tests__ dir.
    mkdirSync(join(src, "demo", "scripts"), { recursive: true });
    writeFileSync(join(src, "demo", "SKILL.md"), "# demo\n");
    writeFileSync(join(src, "demo", "scripts", "manifest.mjs"), "export const x = 1;\n");
    writeFileSync(join(src, "demo", "scripts", "manifest.test.mjs"), "// should not ship\n");
    mkdirSync(join(src, "demo", "__tests__"), { recursive: true });
    writeFileSync(join(src, "demo", "__tests__", "extra.mjs"), "// should not ship\n");
  });

  afterEach(() => {
    rmSync(join(src, ".."), { recursive: true, force: true });
  });

  it("copies real content but omits *.test.* files and __tests__ dirs", () => {
    copyDir(src, dest);

    // Shipped content is present.
    expect(existsSync(join(dest, "demo", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dest, "demo", "scripts", "manifest.mjs"))).toBe(true);

    // Test artifacts are excluded.
    expect(existsSync(join(dest, "demo", "scripts", "manifest.test.mjs"))).toBe(false);
    expect(existsSync(join(dest, "demo", "__tests__"))).toBe(false);
  });

  it("still honors an additional caller-supplied filter", () => {
    // Only copy .md files; the default test exclusion still applies underneath.
    copyDir(src, dest, (name) => name.endsWith(".md") || !name.includes("."));
    expect(existsSync(join(dest, "demo", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dest, "demo", "scripts", "manifest.mjs"))).toBe(false); // filtered out (not .md)
    expect(existsSync(join(dest, "demo", "scripts", "manifest.test.mjs"))).toBe(false); // excluded by default
  });
});
