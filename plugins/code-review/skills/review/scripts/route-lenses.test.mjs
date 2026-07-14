/**
 * Tests for route-lenses.mjs — the frontmatter parser and the pure
 * signals+catalog → roster routing function.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir, removeDir } from "./test-support/git-fixture.mjs";
import { loadLensCatalog, parseFlowMap, parseFrontmatter, routeLenses } from "./route-lenses.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_LENSES_DIR = path.join(HERE, "..", "lenses");

function baseSignals(overrides = {}) {
  return {
    changed: { files: [], by_ext: {}, dirs: [] },
    manifests: [],
    deps: [],
    bins: false,
    diff: {
      lines: 0,
      files: 0,
      new_files: 0,
      renames: 0,
      api_surface: false,
      tests_touched: false,
      source_touched: false,
      docs_only: false,
    },
    tools: { linter: null, formatter: null, test_framework: null },
    remote_host: null,
    ...overrides,
  };
}

describe("parseFlowMap", () => {
  it("parses a simple flow mapping with quoted string values", () => {
    expect(parseFlowMap('{ ext: "ts,tsx,mts,cts" }')).toEqual({ ext: "ts,tsx,mts,cts" });
  });

  it("parses a nested flow mapping (pack `when`)", () => {
    expect(parseFlowMap('{ id: "cobra", when: { dep: "spf13/cobra" } }')).toEqual({
      id: "cobra",
      when: { dep: "spf13/cobra" },
    });
  });

  it("parses a boolean literal value", () => {
    expect(parseFlowMap("{ bin: true }")).toEqual({ bin: true });
  });

  it("throws on malformed input", () => {
    expect(() => parseFlowMap("{ ext: ts,tsx }")).toThrow();
  });
});

describe("parseFrontmatter", () => {
  it("parses scalars, folded block scalars, and flow-mapping lists", () => {
    const content = `---
lens: demo
description: A demo lens
charter: >
  Owns demo findings.
route: auto
match:
  - { ext: "ts,tsx" }
  - { manifest: "package.json", diff: "source_touched" }
miss_cost: high
requires: [built-worktree, gh]
packs:
  - { id: "pack-a" }
  - { id: "pack-b", when: { dep: "eslint" } }
sources:
  - https://example.com/a
  - https://example.com/b
---

# Body
`;
    const fm = parseFrontmatter(content);
    expect(fm.lens).toBe("demo");
    expect(fm.description).toBe("A demo lens");
    expect(fm.charter).toBe("Owns demo findings.");
    expect(fm.route).toBe("auto");
    expect(fm.match).toEqual([{ ext: "ts,tsx" }, { manifest: "package.json", diff: "source_touched" }]);
    expect(fm.miss_cost).toBe("high");
    expect(fm.requires).toEqual(["built-worktree", "gh"]);
    expect(fm.packs).toEqual([{ id: "pack-a" }, { id: "pack-b", when: { dep: "eslint" } }]);
    expect(fm.sources).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("throws when there is no frontmatter block", () => {
    expect(() => parseFrontmatter("# just a body\n")).toThrow();
  });
});

describe("loadLensCatalog", () => {
  let dir;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = undefined;
  });

  it("returns an empty array for a missing directory", () => {
    expect(loadLensCatalog("/nonexistent/lenses/dir")).toEqual([]);
  });

  it("loads and parses every .md file in a directory", () => {
    dir = tempDir("lens-catalog-");
    fs.writeFileSync(
      path.join(dir, "a.md"),
      "---\nlens: a\ndescription: A\ncharter: >\n  Owns A.\nroute: always\n---\nbody\n",
    );
    fs.writeFileSync(path.join(dir, "not-a-lens.txt"), "ignored");
    const catalog = loadLensCatalog(dir);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].lens).toBe("a");
  });
});

describe("routeLenses", () => {
  const catalog = [
    { lens: "always-lens", route: "always", miss_cost: undefined },
    { lens: "auto-lens", route: "auto", match: [{ ext: "ts,tsx" }], miss_cost: "high" },
    {
      lens: "auto-or-lens",
      route: "auto",
      match: [{ ext: "rs" }, { manifest: "go.mod" }],
      miss_cost: "high",
    },
    { lens: "judgment-lens", route: "judgment", description: "desc", summon: "when reshaping structure" },
  ];

  it("always includes an `always` lens regardless of signals", () => {
    const { roster } = routeLenses(baseSignals(), catalog);
    expect(roster.map((r) => r.lens)).toContain("always-lens");
  });

  it("includes an `auto` lens when its match predicate holds", () => {
    const signals = baseSignals({ changed: { files: ["a.ts"], by_ext: { ts: 1 }, dirs: [] } });
    const { roster, skipped } = routeLenses(signals, catalog);
    expect(roster.map((r) => r.lens)).toContain("auto-lens");
    expect(skipped.map((s) => s.lens)).not.toContain("auto-lens");
  });

  it("skips an `auto` lens when no group in its match list holds, and reports why", () => {
    const { roster, skipped } = routeLenses(baseSignals(), catalog);
    expect(roster.map((r) => r.lens)).not.toContain("auto-lens");
    const entry = skipped.find((s) => s.lens === "auto-lens");
    expect(entry).toBeDefined();
    expect(entry.unmet.length).toBeGreaterThan(0);
  });

  it("matches an OR-of-AND `match` list against the second group", () => {
    const signals = baseSignals({ manifests: ["go.mod"] });
    const { roster } = routeLenses(signals, catalog);
    const entry = roster.find((r) => r.lens === "auto-or-lens");
    expect(entry).toBeDefined();
    expect(entry.reason).toContain("manifest");
  });

  it("never auto-includes a `judgment` lens, but surfaces it as a candidate", () => {
    const { roster, judgment_candidates } = routeLenses(baseSignals(), catalog);
    expect(roster.map((r) => r.lens)).not.toContain("judgment-lens");
    expect(judgment_candidates.map((c) => c.lens)).toContain("judgment-lens");
  });

  it("--with pins a lens into the roster even if it wouldn't otherwise match", () => {
    const { roster } = routeLenses(baseSignals(), catalog, { with: ["judgment-lens", "auto-lens"] });
    expect(roster.map((r) => r.lens)).toEqual(expect.arrayContaining(["judgment-lens", "auto-lens"]));
    expect(roster.find((r) => r.lens === "judgment-lens").reason).toBe("pin");
  });

  it("--without removes even an `always` lens", () => {
    const { roster, skipped } = routeLenses(baseSignals(), catalog, { without: ["always-lens"] });
    expect(roster.map((r) => r.lens)).not.toContain("always-lens");
    expect(skipped.map((s) => s.lens)).toContain("always-lens");
  });

  it("resolves a lens's packs to absolute paths, filtering by `when`", () => {
    const withPacks = [
      {
        lens: "pack-lens",
        route: "always",
        packs: [{ id: "unconditional" }, { id: "gated", when: { dep: "eslint" } }],
      },
    ];
    const noDeps = routeLenses(baseSignals(), withPacks, { packsDir: "/packs" });
    expect(noDeps.roster[0].packs).toEqual(["/packs/unconditional.md"]);

    const withDep = routeLenses(baseSignals({ deps: ["eslint"] }), withPacks, { packsDir: "/packs" });
    expect(withDep.roster[0].packs).toEqual(
      expect.arrayContaining(["/packs/unconditional.md", "/packs/gated.md"]),
    );
  });

  it("resolves a `skill:` pack reference to the user skills directory, not packsDir", () => {
    const withSkillPack = [{ lens: "skill-lens", route: "always", packs: [{ id: "skill:typescript-coding" }] }];
    const { roster } = routeLenses(baseSignals(), withSkillPack, { packsDir: "/packs" });
    expect(roster[0].packs[0]).toMatch(/\.claude\/skills\/typescript-coding\/SKILL\.md$/);
  });
});

describe("routeLenses — table-driven scenarios against the real catalog", () => {
  const catalog = loadLensCatalog(REAL_LENSES_DIR);

  it("loads the real catalog with the nine expected lenses", () => {
    expect(catalog.map((l) => l.lens).sort()).toEqual(
      ["api-design", "architecture", "cli-ux", "generalist", "go", "ruby", "rust", "tests", "typescript"].sort(),
    );
  });

  it("a TypeScript repo with source changes routes generalist + tests + typescript", () => {
    const signals = baseSignals({
      changed: { files: ["src/index.ts"], by_ext: { ts: 1 }, dirs: ["src"] },
      manifests: ["package.json", "tsconfig.json"],
      diff: { ...baseSignals().diff, source_touched: true },
    });
    const { roster } = routeLenses(signals, catalog);
    expect(roster.map((r) => r.lens).sort()).toEqual(["generalist", "tests", "typescript"].sort());
  });

  it("a docs-only change routes generalist only", () => {
    const signals = baseSignals({
      changed: { files: ["README.md"], by_ext: { md: 1 }, dirs: [] },
      diff: { ...baseSignals().diff, docs_only: true },
    });
    const { roster } = routeLenses(signals, catalog);
    expect(roster.map((r) => r.lens)).toEqual(["generalist"]);
  });

  it("a Cobra Go repo routes generalist + tests + go + cli-ux", () => {
    const signals = baseSignals({
      changed: { files: ["cmd/root.go"], by_ext: { go: 1 }, dirs: ["cmd"] },
      manifests: ["go.mod"],
      deps: ["spf13/cobra"],
      diff: { ...baseSignals().diff, source_touched: true },
    });
    const { roster } = routeLenses(signals, catalog);
    expect(roster.map((r) => r.lens).sort()).toEqual(["cli-ux", "generalist", "go", "tests"].sort());
  });

  it("--with architecture, --without tests overrides default routing on a docs-only change", () => {
    const signals = baseSignals({
      changed: { files: ["README.md"], by_ext: { md: 1 }, dirs: [] },
      diff: { ...baseSignals().diff, docs_only: true },
    });
    const { roster } = routeLenses(signals, catalog, { with: ["architecture"], without: ["tests"] });
    expect(roster.map((r) => r.lens).sort()).toEqual(["architecture", "generalist"].sort());
    expect(roster.find((r) => r.lens === "architecture").reason).toBe("pin");
  });
});
