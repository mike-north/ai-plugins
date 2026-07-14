/**
 * Tests for catalog-lint.mjs — structural validation of the lens/pack catalog.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { removeDir, tempDir } from "./test-support/git-fixture.mjs";
import { lintCatalog } from "./catalog-lint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_LENSES_DIR = path.join(HERE, "..", "lenses");
const REAL_PACKS_DIR = path.join(HERE, "..", "packs");

const GOOD_LENS = `---
lens: good
description: A good lens
charter: >
  Owns good findings.
route: always
---

# Good Lens

Body content here.

## Do NOT comment on

- Things owned by other lenses.
`;

function writeLens(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

function writePack(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

let lensesDir;
let packsDir;

afterEach(() => {
  if (lensesDir) removeDir(path.dirname(lensesDir));
  lensesDir = undefined;
  packsDir = undefined;
});

function freshDirs() {
  const root = tempDir("catalog-lint-");
  lensesDir = path.join(root, "lenses");
  packsDir = path.join(root, "packs");
  fs.mkdirSync(lensesDir, { recursive: true });
  fs.mkdirSync(packsDir, { recursive: true });
}

describe("lintCatalog — the real, shipped catalog", () => {
  it("passes with zero errors", () => {
    const { errors } = lintCatalog({ lensesDir: REAL_LENSES_DIR, packsDir: REAL_PACKS_DIR });
    expect(errors).toEqual([]);
  });
});

describe("lintCatalog — structural checks (fixtures)", () => {
  it("accepts a well-formed lens with no errors", () => {
    freshDirs();
    writeLens(lensesDir, "good.md", GOOD_LENS);
    const { errors } = lintCatalog({ lensesDir, packsDir });
    expect(errors).toEqual([]);
  });

  it("rejects a lens missing the 'Do NOT comment on' scope fence", () => {
    freshDirs();
    const badLens = GOOD_LENS.replace(/## Do NOT comment on[\s\S]*/, "");
    writeLens(lensesDir, "bad.md", badLens);
    const { errors } = lintCatalog({ lensesDir, packsDir });
    expect(errors.some((e) => e.includes("Do NOT comment on"))).toBe(true);
  });

  it("rejects a lens missing a required field", () => {
    freshDirs();
    const badLens = GOOD_LENS.replace("description: A good lens\n", "");
    writeLens(lensesDir, "bad.md", badLens);
    const { errors } = lintCatalog({ lensesDir, packsDir });
    expect(errors.some((e) => e.includes('missing required field "description"'))).toBe(true);
  });

  it("rejects an 'auto' route lens with no match list", () => {
    freshDirs();
    const badLens = GOOD_LENS.replace("route: always", "route: auto");
    writeLens(lensesDir, "bad.md", badLens);
    const { errors } = lintCatalog({ lensesDir, packsDir });
    expect(errors.some((e) => e.includes('requires a non-empty "match"'))).toBe(true);
  });

  it("rejects a 'judgment' route lens with no summon", () => {
    freshDirs();
    const badLens = GOOD_LENS.replace("route: always", "route: judgment");
    writeLens(lensesDir, "bad.md", badLens);
    const { errors } = lintCatalog({ lensesDir, packsDir });
    expect(errors.some((e) => e.includes('requires a non-empty "summon"'))).toBe(true);
  });

  it("rejects a lens body exceeding the 1200-word limit", () => {
    freshDirs();
    const longBody = GOOD_LENS + "word ".repeat(1300);
    writeLens(lensesDir, "bad.md", longBody);
    const { errors } = lintCatalog({ lensesDir, packsDir });
    expect(errors.some((e) => e.includes("exceeds the 1200-word limit"))).toBe(true);
  });

  it("rejects a lens whose packs reference a nonexistent pack", () => {
    freshDirs();
    const badLens = GOOD_LENS.replace("route: always\n", 'route: always\npacks:\n  - { id: "missing-pack" }\n');
    writeLens(lensesDir, "bad.md", badLens);
    const { errors } = lintCatalog({ lensesDir, packsDir });
    expect(errors.some((e) => e.includes('unknown pack "missing-pack"'))).toBe(true);
  });

  it("allows a lens's `skill:` pack reference without requiring a pack file", () => {
    freshDirs();
    const withSkillPack = GOOD_LENS.replace(
      "route: always\n",
      'route: always\npacks:\n  - { id: "skill:typescript-coding" }\n',
    );
    writeLens(lensesDir, "good.md", withSkillPack);
    const { errors } = lintCatalog({ lensesDir, packsDir });
    expect(errors).toEqual([]);
  });

  it("rejects a pack whose loads_into references an unknown lens", () => {
    freshDirs();
    writeLens(lensesDir, "good.md", GOOD_LENS);
    writePack(
      packsDir,
      "orphan.md",
      '---\npack: orphan\nloads_into: [nonexistent-lens]\nverified: "2026-01"\n---\n\nBody.\n',
    );
    const { errors } = lintCatalog({ lensesDir, packsDir });
    expect(errors.some((e) => e.includes('references unknown lens "nonexistent-lens"'))).toBe(true);
  });

  it("rejects a pack body exceeding the 600-word limit", () => {
    freshDirs();
    writeLens(lensesDir, "good.md", GOOD_LENS);
    const longBody = `---\npack: bloated\nloads_into: [good]\nverified: "2026-01"\n---\n\n${"word ".repeat(700)}`;
    writePack(packsDir, "bloated.md", longBody);
    const { errors } = lintCatalog({ lensesDir, packsDir });
    expect(errors.some((e) => e.includes("exceeds the 600-word limit"))).toBe(true);
  });

  it("warns (but does not error) on a pack verified more than 12 months ago", () => {
    freshDirs();
    writeLens(lensesDir, "good.md", GOOD_LENS);
    writePack(packsDir, "stale.md", '---\npack: stale\nloads_into: [good]\nverified: "2020-01"\n---\n\nBody.\n');
    const { errors, warnings } = lintCatalog({ lensesDir, packsDir });
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("more than 12 months old"))).toBe(true);
  });

  it("warns on two lenses with highly similar charters (possible overlap)", () => {
    freshDirs();
    const charterText = ">\n  Owns logic bugs, error handling, race conditions, and security vulnerabilities in changed code.\n";
    const lensA = GOOD_LENS.replace("lens: good", "lens: aaa").replace("charter: >\n  Owns good findings.\n", `charter: ${charterText}`);
    const lensB = GOOD_LENS.replace("lens: good", "lens: bbb").replace("charter: >\n  Owns good findings.\n", `charter: ${charterText}`);
    writeLens(lensesDir, "aaa.md", lensA);
    writeLens(lensesDir, "bbb.md", lensB);
    const { errors, warnings } = lintCatalog({ lensesDir, packsDir });
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("possible overlap"))).toBe(true);
  });

  it("errors when the lenses directory does not exist", () => {
    const { errors } = lintCatalog({ lensesDir: "/nonexistent/lenses", packsDir: "/nonexistent/packs" });
    expect(errors.some((e) => e.includes("lenses directory not found"))).toBe(true);
  });
});
