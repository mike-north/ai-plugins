/**
 * Tests for src/build-standalone.ts.
 *
 * Two regression guards live here:
 *
 *  1. Standalone-export copy boundary (`isDistributable` / `copyDir`):
 *     build:standalone copies plugin source (notably `skills/`) into `dist/`.
 *     Before the fix it copied directories wholesale, so a test file colocated
 *     inside a skill (e.g. `scripts/foo.test.mjs` next to `foo.mjs`) was shipped
 *     into every standalone export — and, for a runner that auto-discovers
 *     tests, executed redundantly from the copies. Test/spec sources and test
 *     directories must be excluded from every copy.
 *
 *  2. Kiro agent JSON generation: an agent frontmatter `description` written as a
 *     YAML block scalar (folded `>-` / literal `|-`) must resolve to its text
 *     value, not the literal indicator token (e.g. `">-"`).
 *
 * @see https://yaml.org/spec/1.2.2/#812-literal-style — literal `|` block scalars
 * @see https://yaml.org/spec/1.2.2/#813-folded-style — folded `>` block scalars
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { buildKiroAgentJson, buildKiroAgents, copyDir, isDistributable } from "../src/build-standalone.js";

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
  let src: string;
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

// --- Kiro agent JSON: block-scalar description resolution ---

const createdDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "build-standalone-kiro-"));
  createdDirs.push(dir);
  return dir;
}

function writeAgentFile(dir: string, relPath: string, content: string): string {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildKiroAgents (full build path)", () => {
  it("resolves a folded (>-) block-scalar description in the generated Kiro JSON", () => {
    const dir = makeTmpDir();
    const pluginDir = join(dir, "plugin");
    const agentsDir = join(pluginDir, "agents");
    writeAgentFile(
      pluginDir,
      "agents/folded-agent.md",
      [
        "---",
        "name: folded-agent",
        "description: >-",
        "  Reviews code for quality issues",
        "  across multiple dimensions.",
        "tools:",
        "  - Read",
        "  - Bash",
        "---",
        "# Folded Agent",
        "Body content.",
      ].join("\n") + "\n",
    );

    const destDir = join(dir, "dist");
    expect(buildKiroAgents(agentsDir, destDir)).toBe(true);

    const jsonPath = join(destDir, ".kiro", "agents", "folded-agent.json");
    const config = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>;

    // The resolved text, NOT the ">-" indicator token.
    expect(config["description"]).toBe("Reviews code for quality issues across multiple dimensions.");
    expect(config["description"]).not.toBe(">-");
    expect(config["name"]).toBe("folded-agent");
    expect(config["tools"]).toEqual(["read", "shell"]);
  });
});

describe("buildKiroAgentJson", () => {
  it("resolves a literal (|-) block-scalar description preserving newlines", () => {
    const dir = makeTmpDir();
    const agentPath = writeAgentFile(
      dir,
      "agent.md",
      ["---", "name: lit-agent", "description: |-", "  Line one", "  line two", "---", "# Body"].join("\n") + "\n",
    );

    const config = buildKiroAgentJson(agentPath);
    expect(config).not.toBeNull();
    expect(config?.["description"]).toBe("Line one\nline two");
    expect(config?.["description"]).not.toBe("|-");
  });

  it("keeps a plain single-line description unchanged", () => {
    const dir = makeTmpDir();
    const agentPath = writeAgentFile(
      dir,
      "agent.md",
      ["---", "name: plain-agent", "description: A plain description", "---", "# Body"].join("\n") + "\n",
    );

    const config = buildKiroAgentJson(agentPath);
    expect(config?.["description"]).toBe("A plain description");
  });
});
