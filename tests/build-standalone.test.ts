/**
 * Tests for src/build-standalone.ts
 *
 * Regression coverage: scripts-centric plugins (e.g. github-fleet-tools, git) ship a
 * `scripts/` directory of executable helpers that their skill docs reference. The Gemini
 * and Kiro standalone exports must include that directory — with the +x bit intact —
 * otherwise the exported bundles are incomplete and the referenced scripts are missing.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGeminiStandalone, buildKiroStandalone } from "../src/build-standalone.js";

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * Write a file inside the given directory, creating intermediate dirs.
 */
function writeFile(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

/**
 * Returns true if the owner-execute bit is set on the file at `filePath`.
 */
function isExecutable(filePath: string): boolean {
  return Boolean(fs.statSync(filePath).mode & 0o100);
}

/**
 * Scaffolds a minimal plugin source tree containing an executable script and
 * the manifest files both standalone targets read. Returns the plugin dir.
 */
function makePluginWithScripts(): string {
  const pluginDir = makeTmpDir("plugin-src-");
  // Gemini + Kiro manifest/context files so the build does meaningful work.
  writeFile(pluginDir, "gemini-extension.json", JSON.stringify({ name: "scripted-plugin" }));
  writeFile(pluginDir, "GEMINI.md", "# context");
  writeFile(pluginDir, "POWER.md", "---\nname: scripted-plugin\n---\n");
  writeFile(pluginDir, "mcp.json", JSON.stringify({ mcpServers: {} }));
  writeFile(pluginDir, "skills/my-skill/SKILL.md", "---\nname: my-skill\ndescription: x\n---\n");

  // An executable helper script + a nested one to verify recursion preserves mode.
  writeFile(pluginDir, "scripts/run.sh", "#!/bin/sh\necho hi\n");
  fs.chmodSync(path.join(pluginDir, "scripts", "run.sh"), 0o755);
  writeFile(pluginDir, "scripts/lib/helper.sh", "#!/bin/sh\necho helper\n");
  fs.chmodSync(path.join(pluginDir, "scripts", "lib", "helper.sh"), 0o755);

  return pluginDir;
}

describe("buildGeminiStandalone — scripts/", () => {
  it("copies scripts/ into the Gemini export, preserving the executable bit", () => {
    const pluginDir = makePluginWithScripts();
    const destDir = makeTmpDir("gemini-dest-");

    const copied = buildGeminiStandalone(pluginDir, destDir);

    const runScript = path.join(destDir, "scripts", "run.sh");
    const nestedScript = path.join(destDir, "scripts", "lib", "helper.sh");

    expect(fs.existsSync(runScript)).toBe(true);
    expect(fs.existsSync(nestedScript)).toBe(true);
    expect(isExecutable(runScript)).toBe(true);
    expect(isExecutable(nestedScript)).toBe(true);
    expect(copied).toContain("scripts/");
  });

  it("omits scripts/ from the export when the plugin has no scripts/ directory", () => {
    const pluginDir = makeTmpDir("plugin-src-");
    writeFile(pluginDir, "gemini-extension.json", JSON.stringify({ name: "no-scripts" }));
    writeFile(pluginDir, "skills/my-skill/SKILL.md", "---\nname: my-skill\ndescription: x\n---\n");
    const destDir = makeTmpDir("gemini-dest-");

    const copied = buildGeminiStandalone(pluginDir, destDir);

    expect(fs.existsSync(path.join(destDir, "scripts"))).toBe(false);
    expect(copied).not.toContain("scripts/");
  });
});

describe("buildKiroStandalone — scripts/", () => {
  it("copies scripts/ into the Kiro export, preserving the executable bit", () => {
    const pluginDir = makePluginWithScripts();
    const destDir = makeTmpDir("kiro-dest-");

    const copied = buildKiroStandalone(pluginDir, destDir);

    const runScript = path.join(destDir, "scripts", "run.sh");
    const nestedScript = path.join(destDir, "scripts", "lib", "helper.sh");

    expect(fs.existsSync(runScript)).toBe(true);
    expect(fs.existsSync(nestedScript)).toBe(true);
    expect(isExecutable(runScript)).toBe(true);
    expect(isExecutable(nestedScript)).toBe(true);
    expect(copied).toContain("scripts/");
  });

  it("omits scripts/ from the export when the plugin has no scripts/ directory", () => {
    const pluginDir = makeTmpDir("plugin-src-");
    writeFile(pluginDir, "POWER.md", "---\nname: no-scripts\n---\n");
    writeFile(pluginDir, "skills/my-skill/SKILL.md", "---\nname: my-skill\ndescription: x\n---\n");
    const destDir = makeTmpDir("kiro-dest-");

    const copied = buildKiroStandalone(pluginDir, destDir);

    expect(fs.existsSync(path.join(destDir, "scripts"))).toBe(false);
    expect(copied).not.toContain("scripts/");
  });
});
