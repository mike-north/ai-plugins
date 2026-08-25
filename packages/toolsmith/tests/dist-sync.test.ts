/**
 * The plugin ships a COMMITTED copy of the CLI bundle
 * (plugins/toolsmith/scripts/toolsmith.mjs) so marketplace installs need no
 * build step. This test rebuilds the bundle from src/ into a temp file and
 * requires byte-identity with the committed copy — a source edit without
 * `pnpm --filter @mike-north/toolsmith build` fails here, so the committed
 * artifact can never silently drift from the TypeScript source.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CLI, REPO_ROOT, cleanupTmpDirs, makeTmpDir } from "./helpers.js";

afterAll(cleanupTmpDirs);

describe("committed plugin bundle", () => {
  it("is byte-identical to a fresh build from src/ (run `pnpm --filter @mike-north/toolsmith build` if this fails)", () => {
    const tmp = makeTmpDir("toolsmith-dist-sync-");
    const freshPath = join(tmp, "toolsmith.mjs");
    execFileSync(process.execPath, [join(REPO_ROOT, "packages", "toolsmith", "scripts", "build.mjs"), "--out", freshPath], {
      stdio: "pipe",
    });
    const fresh = readFileSync(freshPath, "utf8");
    const committed = readFileSync(CLI, "utf8");
    expect(committed).toBe(fresh);
  });

  it("reports the package.json version for --version (never a hand-typed literal)", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "packages", "toolsmith", "package.json"), "utf8")) as {
      version: string;
    };
    const out = execFileSync(process.execPath, [CLI, "--version"], { encoding: "utf8" });
    expect(out.trim()).toBe(pkg.version);
  });
});
