/**
 * Regression tests for the direct-invocation entry guard (`isMainModule` in
 * lib/cli.mjs) shared by every CLI script in this directory.
 *
 * Two historical failure modes, both producing the same symptom — the script
 * exits 0 with no output, a silent no-op that looks like success:
 *
 * 1. Percent-encoding: the old guard compared `import.meta.url` against a
 *    hand-built `file://${process.argv[1]}` template string. `import.meta.url`
 *    percent-encodes special characters (a space becomes %20) while the
 *    template string does not, so any install path containing a space (e.g.
 *    "~/Library/Application Support/...") broke the comparison.
 * 2. Symlinks: Node resolves the main ES module to its real path before
 *    loading it, so `import.meta.url` reflects the realpath while
 *    `process.argv[1]` keeps the symlinked spelling (macOS `/tmp` →
 *    `/private/tmp`). A naive `pathToFileURL(process.argv[1])` comparison
 *    breaks there too.
 *
 * Each test copies the scripts tree into a temp directory whose path contains
 * a space, invokes every script directly (once via the plain path, once
 * through a symlinked directory), and asserts the CLI entry actually ran:
 * every script here either prints usage/output or exits non-zero when run
 * with no args, whereas a broken guard produces exit 0 with zero output.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/cli.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CLI_SCRIPTS = [
  "catalog-lint.mjs",
  "merge-findings.mjs",
  "post-review.mjs",
  "record-finding.mjs",
  "render-findings.mjs",
  "render-review.mjs",
  "review-cleanup.mjs",
  "review-init.mjs",
  "route-lenses.mjs",
  "signals.mjs",
];

let spacedDir;
let scriptsDir;
let symlinkDir;

beforeAll(() => {
  // mkdtemp with a space in the prefix yields a directory with a space in its
  // path, mirroring installs under "…/Application Support/…".
  spacedDir = fs.mkdtempSync(path.join(os.tmpdir(), "entry guard "));
  scriptsDir = path.join(spacedDir, "scripts");
  fs.cpSync(HERE, scriptsDir, { recursive: true });
  // A symlinked spelling of the same directory: argv[1] goes through the
  // link while Node loads the module from its realpath.
  symlinkDir = path.join(spacedDir, "linked scripts");
  fs.symlinkSync(scriptsDir, symlinkDir, "dir");
});

afterAll(() => {
  fs.rmSync(spacedDir, { recursive: true, force: true });
});

function runDirect(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // spawnSync reports status null when the child timed out or died to a
  // signal — a hang or crash, never proof the entry ran.
  const completed = result.error == null && result.signal == null && result.status != null;
  // A broken guard's signature: clean exit with no output at all.
  return {
    entryRan: completed && (result.status !== 0 || output.trim().length > 0),
    status: result.status,
    signal: result.signal,
  };
}

describe("direct invocation from a path containing a space", () => {
  for (const script of CLI_SCRIPTS) {
    it(`${script} runs its CLI entry (not a silent no-op)`, () => {
      const { entryRan, status, signal } = runDirect(path.join(scriptsDir, script));
      expect(entryRan, `${script} exited status=${status} signal=${signal} with no output — entry guard did not fire`).toBe(true);
    });
  }
});

describe("direct invocation through a symlinked directory", () => {
  for (const script of CLI_SCRIPTS) {
    it(`${script} runs its CLI entry (not a silent no-op)`, () => {
      const { entryRan, status, signal } = runDirect(path.join(symlinkDir, script));
      expect(entryRan, `${script} exited status=${status} signal=${signal} with no output — entry guard did not fire`).toBe(true);
    });
  }
});

describe("isMainModule", () => {
  it("is false for a module that was imported rather than run", () => {
    // Under vitest, process.argv[1] is the test runner, not this file.
    expect(isMainModule(import.meta.url)).toBe(false);
  });

  it("tolerates a nonexistent argv[1] instead of throwing", () => {
    const original = process.argv[1];
    try {
      process.argv[1] = path.join(spacedDir, "does not exist.mjs");
      expect(isMainModule(import.meta.url)).toBe(false);
    } finally {
      process.argv[1] = original;
    }
  });

  it("is false when argv[1] is absent", () => {
    const original = process.argv[1];
    try {
      process.argv[1] = undefined;
      expect(isMainModule(import.meta.url)).toBe(false);
    } finally {
      process.argv[1] = original;
    }
  });
});
