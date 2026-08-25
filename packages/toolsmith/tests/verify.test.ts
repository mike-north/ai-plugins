/**
 * Regression tests for `toolsmith verify` — the read-only integrity-check
 * side of the toolsmith proofread-then-allowlist handshake
 * (docs/toolsmith/staged-live-split.md). Ported case-for-case from the
 * `--verify` cases of plugins/toolsmith/scripts/test-approve.sh (bash),
 * which this file supersedes for the new `toolsmith verify [<path>] [--user]`
 * CLI (see plugins/toolsmith/scripts/toolsmith.mjs). Promotion-side cases
 * live in approve.test.ts.
 *
 * Test-to-acceptance-criteria mapping (docs/toolsmith/staged-live-split.md
 * §Acceptance criteria): these cases exercise AC1 (lockout dead — verify
 * must never touch live) and the verify contract in §2 (producer side).
 *
 * @see docs/toolsmith/staged-live-split.md
 */
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  chflagsAvailableInTests,
  cleanupTmpDirs,
  makeTmpDir,
  newDraftTool,
  newHome,
  newProj,
  type RegistryToolInit,
  runCli,
  SINCE,
  sha256Hex,
  writeProjectRegistry,
  writeStaged,
  writeUserRegistry,
  writeUserStaged,
} from "./helpers.js";

afterAll(cleanupTmpDirs);

const DRAFT = "#!/bin/bash\necho hi\n";

interface RegistryFile {
  version: number;
  tools: Array<Record<string, unknown>>;
}

function readRegistryFile(path: string): RegistryFile {
  return JSON.parse(readFileSync(path, "utf8")) as RegistryFile;
}

function writeRegistryFile(path: string, registry: RegistryFile): void {
  writeFileSync(path, JSON.stringify(registry, null, 2) + "\n");
}

const regPathOf = (proj: string): string => join(proj, ".claude", "toolsmith", "registry.json");
const liveAbsOf = (proj: string, name: string): string => join(proj, "scripts", "agent-tools", name);

function newUserDraftTool(name: string, note = "initial draft"): RegistryToolInit {
  return {
    name,
    path: `tools/${name}`,
    status: "draft",
    staged: { path: `staging/${name}`, sha256: "advisory-only-not-trusted", note, since: SINCE },
  };
}

const userLiveAbsOf = (home: string, name: string): string => join(home, ".claude", "toolsmith", "tools", name);

// A fake project dir so --user runs never fall back to the real cwd project.
const NO_PROJ = "/nonexistent-should-not-be-used";

/** Clear a possible uchg flag (best-effort) before rewriting/removing a
 * promoted live file, mirroring the bash suite's pattern at each mutation. */
function clearImmutable(path: string): void {
  if (chflagsAvailableInTests()) spawnSync("chflags", ["nouchg", path]);
}

// ============================================================================
// verify: OK / DRIFTED / MISSING / draft (unaffected by the staged rewrite —
// verify only ever inspects the LIVE pin, per contract §2).
// ============================================================================
describe("verify: OK / DRIFTED / MISSING after a real promotion", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  runCli(["approve", "scripts/agent-tools/mytool"], { proj });

  const okOut = runCli(["verify"], { proj });

  it("verify OK when matching", () => {
    expect(okOut.status).toBe(0);
    expect(okOut.stdout).toMatch(/^OK\s/m);
  });

  // Mode is 0555 now (not 0755), so drifting the file requires nouchg first
  // where chflags is available.
  const liveAbs = liveAbsOf(proj, "mytool");
  clearImmutable(liveAbs);
  chmodSync(liveAbs, 0o755);
  writeFileSync(liveAbs, "#!/bin/bash\necho DRIFTED\n");
  const driftOut = runCli(["verify"], { proj });

  it("verify DRIFTED after forced edit", () => {
    expect(driftOut.status).not.toBe(0);
    expect(driftOut.stdout).toMatch(/^DRIFTED\s/m);
  });

  clearImmutable(liveAbs);
  rmSync(liveAbs);
  const missingOut = runCli(["verify"], { proj });

  it("verify MISSING after delete", () => {
    expect(missingOut.status).not.toBe(0);
    expect(missingOut.stdout).toMatch(/^MISSING\s/m);
  });
});

describe("verify: draft entries report without failing", () => {
  const proj = newProj();
  writeProjectRegistry(proj, [{ name: "mytool", path: "scripts/agent-tools/mytool", status: "draft" }]);
  const out = runCli(["verify"], { proj });

  it("verify reports draft without failing", () => {
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/^draft\s/m);
  });
});

// ============================================================================
// verify: a revoked (retired) entry reports "retired", distinct from
// "draft" — this one was live once and no longer is — and does not fail the
// run even though its live file is gone.
// ============================================================================
describe("verify: retired entries report distinctly from draft, without failing", () => {
  const proj = newProj();
  writeProjectRegistry(proj, [
    {
      name: "mytool",
      path: "scripts/agent-tools/mytool",
      status: "retired",
      approvedSha256: "deadbeef",
      permissionRule: "Bash(scripts/agent-tools/mytool:*)",
    },
  ]);
  const out = runCli(["verify"], { proj });

  it("verify reports retired (not draft, not MISSING) without failing", () => {
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/^retired\s/m);
    expect(out.stdout).not.toMatch(/^draft\s/m);
    expect(out.stdout).not.toMatch(/^MISSING\s/m);
  });
});

// ============================================================================
// verify: a tampered registry entry with an absolute path or ".." must NOT be
// read/hashed outside the project root — report MISSING and fail the run,
// while a valid sibling entry in the same registry still verifies normally.
// ============================================================================
describe("verify never reads outside project root for absolute/.. registry paths", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  runCli(["approve", "scripts/agent-tools/mytool"], { proj });

  const outsideDir = makeTmpDir("toolsmith-outside-");
  const outsideFile = join(outsideDir, "outside");
  writeFileSync(outsideFile, "not part of this project\n");
  const outsideSha = sha256Hex("not part of this project\n");

  const registry = readRegistryFile(regPathOf(proj));
  registry.tools.push(
    {
      name: "tampered-absolute",
      path: outsideFile,
      purpose: "x",
      args: "",
      scope: "x",
      covers: [],
      status: "approved",
      approvedSha256: outsideSha,
      permissionRule: `Bash(${outsideFile}:*)`,
    },
    {
      name: "tampered-traversal",
      path: "../../../../etc/passwd",
      purpose: "x",
      args: "",
      scope: "x",
      covers: [],
      status: "approved",
      approvedSha256: "deadbeef",
      permissionRule: "Bash(../../../../etc/passwd:*)",
    },
  );
  writeRegistryFile(regPathOf(proj), registry);

  const out = runCli(["verify"], { proj });

  it("verify never reads outside project root for absolute/.. registry paths", () => {
    expect(out.status).not.toBe(0);
    expect(out.stdout).toMatch(/^OK\s+mytool/m);
    expect(out.stdout).toMatch(/^MISSING\s+tampered-absolute/m);
    expect(out.stdout).toMatch(/^MISSING\s+tampered-traversal/m);
  });
});

// ============================================================================
// user scope: --verify --user reports OK / DRIFTED / MISSING
// ============================================================================
describe("user scope: verify --user reports OK / DRIFTED / MISSING", () => {
  const home = newHome();
  writeUserStaged(home, "mytool", DRAFT);
  writeUserRegistry(home, [newUserDraftTool("mytool")]);
  runCli(["approve", "mytool", "--user"], { proj: NO_PROJ, home });

  const okOut = runCli(["verify", "--user"], { proj: NO_PROJ, home });

  it("user --verify OK when matching", () => {
    expect(okOut.status).toBe(0);
    expect(okOut.stdout).toMatch(/^OK\s/m);
  });

  const liveAbs = userLiveAbsOf(home, "mytool");
  clearImmutable(liveAbs);
  chmodSync(liveAbs, 0o755);
  writeFileSync(liveAbs, "#!/bin/bash\necho DRIFTED\n");
  const driftOut = runCli(["verify", "--user"], { proj: NO_PROJ, home });

  it("user --verify DRIFTED after forced edit", () => {
    expect(driftOut.status).not.toBe(0);
    expect(driftOut.stdout).toMatch(/^DRIFTED\s/m);
  });

  clearImmutable(liveAbs);
  rmSync(liveAbs);
  const missingOut = runCli(["verify", "--user"], { proj: NO_PROJ, home });

  it("user --verify MISSING after delete", () => {
    expect(missingOut.status).not.toBe(0);
    expect(missingOut.stdout).toMatch(/^MISSING\s/m);
  });
});

// ============================================================================
// $HOME-rooted session (issue #36): verifying WITHOUT --user must refuse with
// a clear pointer to --user (fail-closed).
// ============================================================================
describe("$HOME-rooted session (issue #36): verify without --user refuses", () => {
  const home = newHome();
  writeUserStaged(home, "mytool", DRAFT);
  writeUserRegistry(home, [newUserDraftTool("mytool")]);

  const out = runCli(["verify"], { proj: home, home });

  it("$HOME-rooted verify without --user refuses", () => {
    expect(out.status).not.toBe(0);
    expect(out.stderr.toLowerCase()).toContain("--user");
  });
});
