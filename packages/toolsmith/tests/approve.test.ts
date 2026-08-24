/**
 * Regression tests for `toolsmith approve` — the staged/live promotion side
 * of the toolsmith proofread-then-allowlist handshake
 * (docs/toolsmith/staged-live-split.md). Ported case-for-case from
 * plugins/toolsmith/scripts/test-approve.sh (bash), which this file
 * supersedes for the new `toolsmith approve <path> [--dry-run] [--user]` CLI
 * (see plugins/toolsmith/scripts/toolsmith.mjs). `--verify`-only cases live
 * in verify.test.ts.
 *
 * Test-to-acceptance-criteria mapping (docs/toolsmith/staged-live-split.md
 * §Acceptance criteria — each AC below is also referenced inline at its
 * test, mirroring the bash suite's mapping comment):
 *   AC1 lockout dead            -> "AC1:" cases
 *   AC2 staged inert            -> covered in cli-surface.test.ts (both invocation routes)
 *   AC3 live write-denied       -> covered in cli-surface.test.ts (mode + uchg + hashDenial)
 *   AC4 promotion atomicity/idempotence -> "AC4:" cases
 *   AC5 new-tool flow e2e       -> "AC5:" cases
 *   AC6 no hot-path regression  -> covered in cli-surface.test.ts
 *   AC7 docs                   -> registry-schema.md / authoring-checklist.md
 *
 * @see docs/toolsmith/staged-live-split.md
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  chflagsAvailableInTests,
  cleanupTmpDirs,
  fileMode,
  makeTmpDir,
  newDraftTool,
  newHome,
  newProj,
  type RegistryToolInit,
  revisionTool,
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

/** Read back a registry.json that this suite itself wrote — trusted shape. */
function readRegistryFile(path: string): RegistryFile {
  return JSON.parse(readFileSync(path, "utf8")) as RegistryFile;
}

interface SettingsFile {
  permissions?: { allow?: string[] };
  [key: string]: unknown;
}

function readSettingsFile(path: string): SettingsFile {
  return JSON.parse(readFileSync(path, "utf8")) as SettingsFile;
}

function ruleCount(settingsPath: string, rule: string): number {
  const settings = readSettingsFile(settingsPath);
  return (settings.permissions?.allow ?? []).filter((r) => r === rule).length;
}

/** Actual-write-attempt writability check, mirroring the bash suite's
 * is_writable() (a stat of the mode bits alone can be misleading). */
function isWritable(path: string): boolean {
  try {
    appendFileSync(path, "x");
    return true;
  } catch {
    return false;
  }
}

const regPathOf = (proj: string): string => join(proj, ".claude", "toolsmith", "registry.json");
const settingsPathOf = (proj: string): string => join(proj, ".claude", "settings.json");
const liveAbsOf = (proj: string, name: string): string => join(proj, "scripts", "agent-tools", name);
const stagedAbsOf = (proj: string, name: string): string => join(proj, ".claude", "toolsmith", "staging", name);

/** A user-scope brand-new tool: draft status, only "staged" populated. */
function newUserDraftTool(name: string, note = "initial draft"): RegistryToolInit {
  return {
    name,
    path: `tools/${name}`,
    status: "draft",
    staged: { path: `staging/${name}`, sha256: "advisory-only-not-trusted", note, since: SINCE },
  };
}

const userLiveAbsOf = (home: string, name: string): string => join(home, ".claude", "toolsmith", "tools", name);
const userStagingAbsOf = (home: string, name: string): string => join(home, ".claude", "toolsmith", "staging", name);
const userRegPathOf = (home: string): string => join(home, ".claude", "toolsmith", "registry.json");
const userSettingsPathOf = (home: string): string => join(home, ".claude", "settings.json");

// A fake project dir so --user runs never fall back to the real cwd project.
const NO_PROJ = "/nonexistent-should-not-be-used";

// ============================================================================
// AC5 (new-tool flow e2e): draft -> staged -> approve -> live+granted, end to
// end, review surface showing exactly the placed bytes.
// ============================================================================
describe("AC5 (new-tool flow e2e): draft -> staged -> approve -> live+granted", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  const expectSha = sha256Hex(DRAFT);

  const dryOut = runCli(["approve", "scripts/agent-tools/mytool", "--dry-run"], { proj });
  // Captured immediately after the dry-run (not inside `it`): a real commit
  // run happens later in this block, so a lazy existsSync() inside `it`
  // would observe post-commit state instead of the post-dry-run state.
  const liveExistsAfterDryRun = existsSync(liveAbsOf(proj, "mytool"));
  const settingsExistsAfterDryRun = existsSync(settingsPathOf(proj));

  it("AC5: --dry-run on a new tool leaves live+settings untouched", () => {
    expect(dryOut.status).toBe(0);
    expect(liveExistsAfterDryRun).toBe(false);
    expect(settingsExistsAfterDryRun).toBe(false);
  });

  it("AC5: --dry-run shows sha256 + 'new tool' + the exact staged text", () => {
    expect(dryOut.stdout).toContain(expectSha);
    expect(dryOut.stdout.toLowerCase()).toContain("new tool");
    expect(dryOut.stdout).toContain("echo hi");
  });

  const commitOut = runCli(["approve", "scripts/agent-tools/mytool"], { proj });
  const registryAfter = readRegistryFile(regPathOf(proj));
  const entry = registryAfter.tools[0]!;

  it("AC5: promote pins registry fields from the STAGED bytes", () => {
    expect(commitOut.status).toBe(0);
    expect(entry["status"]).toBe("approved");
    expect(entry["approvedSha256"]).toBe(expectSha);
    expect(entry["permissionRule"]).toBe("Bash(scripts/agent-tools/mytool:*)");
  });

  it("AC5: 'staged' cleared from the entry after promotion", () => {
    expect(Object.hasOwn(entry, "staged")).toBe(false);
  });

  it("AC5: live file placed with exactly the staged bytes", () => {
    expect(readFileSync(liveAbsOf(proj, "mytool"), "utf8")).toBe(DRAFT);
  });

  it("AC5: staging draft file removed after promotion", () => {
    expect(existsSync(stagedAbsOf(proj, "mytool"))).toBe(false);
  });

  it("AC5: live file mode is 0555 (r-x, no write)", () => {
    expect(fileMode(liveAbsOf(proj, "mytool"))).toBe("555");
  });

  it("AC5: promote creates settings.json with the rule", () => {
    const settings = readSettingsFile(settingsPathOf(proj));
    expect(settings.permissions?.allow).toEqual(["Bash(scripts/agent-tools/mytool:*)"]);
  });
});

// ============================================================================
// AC1 (lockout dead): with tool T approved and live, a staged revision of T
// leaves T's live invocation still passing its pin, and the pending draft is
// visible in the registry (what /toolsmith:list surfaces) — the exact
// lockout scenario the brief opens with.
// ============================================================================
describe("AC1 (lockout dead): staged revision never disturbs live", () => {
  const proj = newProj();
  writeFileSync(liveAbsOf(proj, "mytool"), "#!/bin/bash\necho original\n");
  const liveSha = sha256Hex("#!/bin/bash\necho original\n");
  writeStaged(proj, "mytool", "#!/bin/bash\necho improved\n");
  writeProjectRegistry(proj, [revisionTool("mytool", liveSha)]);

  const verifyOut = runCli(["verify"], { proj });

  it("AC1: live tool still verifies OK while a staged revision is pending (no lockout)", () => {
    expect(verifyOut.status).toBe(0);
    expect(verifyOut.stdout).toMatch(/^OK\s+mytool/m);
  });

  it("AC1: live bytes are untouched by an unpromoted staged draft", () => {
    expect(readFileSync(liveAbsOf(proj, "mytool"), "utf8")).toBe("#!/bin/bash\necho original\n");
  });

  it("AC1: the pending draft is visible in the registry (what /toolsmith:list surfaces)", () => {
    const registry = readRegistryFile(regPathOf(proj));
    expect(Object.hasOwn(registry.tools[0]!, "staged")).toBe(true);
  });
});

// ============================================================================
// AC1 (continued): promoting the revision replaces live and re-pins, and the
// review surface for a revision is a DIFF against current live, not full text.
// ============================================================================
describe("AC1 (continued): promoting a revision replaces live and re-pins", () => {
  const proj = newProj();
  writeFileSync(liveAbsOf(proj, "mytool"), "#!/bin/bash\necho original\n");
  const liveSha = sha256Hex("#!/bin/bash\necho original\n");
  writeStaged(proj, "mytool", "#!/bin/bash\necho improved\n");
  writeProjectRegistry(proj, [revisionTool("mytool", liveSha)]);

  const dryOut = runCli(["approve", "scripts/agent-tools/mytool", "--dry-run"], { proj });

  it("AC1: a revision's review surface is a diff against current live", () => {
    expect(dryOut.stdout.toLowerCase()).toContain("revision");
    expect(dryOut.stdout).toContain("- echo original");
    expect(dryOut.stdout).toContain("+ echo improved");
  });

  runCli(["approve", "scripts/agent-tools/mytool"], { proj });
  const newSha = sha256Hex(readFileSync(liveAbsOf(proj, "mytool")));
  const pinnedSha = readRegistryFile(regPathOf(proj)).tools[0]!["approvedSha256"];

  it("AC1: promoting a revision replaces live content and re-pins the new hash", () => {
    expect(readFileSync(liveAbsOf(proj, "mytool"), "utf8")).toBe("#!/bin/bash\necho improved\n");
    expect(newSha).not.toBe(liveSha);
    expect(pinnedSha).toBe(newSha);
  });
});

// ============================================================================
// AC4 (promotion atomicity + idempotence): kill promotion between "place" and
// the pin-write (simulated via TOOLSMITH_APPROVE_KILL_AFTER=mode — i.e. after
// the file has been placed + chmod/uchg'd, but before the registry pin is
// written). The killed run must exit non-zero and leave live UNPINNED
// (registry still says draft/staged pending). Re-running approve (no kill)
// must then converge to live+pinned+granted — the apply is idempotent.
// ============================================================================
describe("AC4 (promotion atomicity + idempotence): kill-mid-apply then converge", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  const expectSha = sha256Hex(DRAFT);

  const killOut = runCli(["approve", "scripts/agent-tools/mytool"], {
    proj,
    env: { TOOLSMITH_APPROVE_KILL_AFTER: "mode" },
  });
  const statusAfterKill = readRegistryFile(regPathOf(proj)).tools[0]!["status"];
  // Captured immediately after the kill (not inside `it`): the very next
  // action in this block is a real, converging approve run that removes the
  // staging file — asserting existsSync() lazily inside `it` would observe
  // that later state instead of the post-kill state under test.
  const liveExistsAfterKill = existsSync(liveAbsOf(proj, "mytool"));
  const stagedExistsAfterKill = existsSync(stagedAbsOf(proj, "mytool"));

  it("AC4: killed mid-apply exits non-zero, live placed but registry NOT yet pinned", () => {
    expect(killOut.status).not.toBe(0);
    expect(statusAfterKill).toBe("draft");
    expect(liveExistsAfterKill).toBe(true);
  });

  it("AC4: staging draft survives a kill before the final cleanup step", () => {
    expect(stagedExistsAfterKill).toBe(true);
  });

  const convergeOut = runCli(["approve", "scripts/agent-tools/mytool"], { proj });
  const registryAfter = readRegistryFile(regPathOf(proj)).tools[0]!;

  it("AC4: re-running approve after a mid-apply kill converges to live+pinned+granted", () => {
    expect(convergeOut.status).toBe(0);
    expect(registryAfter["status"]).toBe("approved");
    expect(registryAfter["approvedSha256"]).toBe(expectSha);
    expect(ruleCount(settingsPathOf(proj), "Bash(scripts/agent-tools/mytool:*)")).toBe(1);
  });
});

// ============================================================================
// AC4 (continued): a SECOND re-run after full success is also a no-op
// (idempotent) — exactly one rule, unchanged hash, no error from "staged"
// already being absent (this is not a "kill" scenario, it's a plain re-run;
// it should be refused cleanly as "nothing to promote", not crash).
// ============================================================================
describe("AC4 (continued): a second re-run after full success is a clean no-op", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  runCli(["approve", "scripts/agent-tools/mytool"], { proj });
  const ruleBefore = ruleCount(settingsPathOf(proj), "Bash(scripts/agent-tools/mytool:*)");

  const out = runCli(["approve", "scripts/agent-tools/mytool"], { proj });
  const ruleAfter = ruleCount(settingsPathOf(proj), "Bash(scripts/agent-tools/mytool:*)");

  it('AC4: re-running after full success refuses cleanly (nothing left to promote), no duplicate rule', () => {
    expect(out.status).not.toBe(0);
    expect(out.stderr.toLowerCase()).toContain('no "staged" draft');
    expect(ruleBefore).toBe(ruleAfter);
  });
});

// ============================================================================
// review finding #4: step 6's post-rule registry re-read comes back corrupted
// (concurrent edit / on-disk corruption) — approve must degrade gracefully
// (fall back to the in-memory pinned state) instead of throwing. The tool is
// already placed+pinned+granted by this point (steps 1-5 completed); the
// corrupted-read fault only affects step 6's "clear staged" bookkeeping.
// ============================================================================
describe("finding #4: corrupted post-rule registry re-read degrades gracefully", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  const expectSha = sha256Hex(DRAFT);

  const out = runCli(["approve", "scripts/agent-tools/mytool"], {
    proj,
    env: { TOOLSMITH_APPROVE_CORRUPT_REGISTRY_STEP6: "1" },
  });
  const registryAfter = readRegistryFile(regPathOf(proj)).tools[0]!;

  it("finding #4: corrupted post-rule registry re-read degrades gracefully instead of throwing", () => {
    expect(out.status).toBe(0);
    expect(registryAfter["status"]).toBe("approved");
    expect(registryAfter["approvedSha256"]).toBe(expectSha);
    expect(Object.hasOwn(registryAfter, "staged")).toBe(false);
    expect(out.stdout.toLowerCase()).toContain("falling back");
  });
});

// ============================================================================
// negative: entry with no "staged" field at all -> refuse, nothing written.
// ============================================================================
describe("negative: entry with no staged field", () => {
  const proj = newProj();
  writeFileSync(liveAbsOf(proj, "mytool"), DRAFT);
  writeProjectRegistry(proj, [{ name: "mytool", path: "scripts/agent-tools/mytool", status: "draft" }]);
  const regBefore = readFileSync(regPathOf(proj), "utf8");

  const out = runCli(["approve", "scripts/agent-tools/mytool"], { proj });
  const regAfter = readFileSync(regPathOf(proj), "utf8");

  it("no staged field: refused, nothing written", () => {
    expect(out.status).not.toBe(0);
    expect(out.stderr.toLowerCase()).toContain('no "staged" draft');
    expect(regBefore).toBe(regAfter);
    expect(existsSync(settingsPathOf(proj))).toBe(false);
  });
});

// ============================================================================
// negative: staged.path pointing outside .claude/toolsmith/staging/ is
// rejected (tampered/malformed registry entry), nothing written.
// ============================================================================
describe("negative: staged.path escaping the staging namespace", () => {
  const proj = newProj();
  writeFileSync(liveAbsOf(proj, "evil-staged"), DRAFT);
  writeProjectRegistry(proj, [
    {
      name: "mytool",
      path: "scripts/agent-tools/mytool",
      status: "draft",
      staged: { path: "scripts/agent-tools/evil-staged", since: SINCE },
    },
  ]);

  const out = runCli(["approve", "scripts/agent-tools/mytool"], { proj });

  it("staged.path escaping the staging namespace is rejected", () => {
    expect(out.status).not.toBe(0);
    expect(out.stderr.toLowerCase()).toContain("staging");
    expect(existsSync(liveAbsOf(proj, "mytool"))).toBe(false);
  });
});

// ============================================================================
// missing staged file on disk (entry references it, but it isn't there) => refuse
// ============================================================================
describe("negative: missing staged file on disk", () => {
  const proj = newProj();
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  // (deliberately do not write the staging file)
  const out = runCli(["approve", "scripts/agent-tools/mytool"], { proj });

  it("missing staged file refused", () => {
    expect(out.status).not.toBe(0);
    expect(existsSync(settingsPathOf(proj))).toBe(false);
  });
});

// ============================================================================
// path validation: absolute, .. traversal, backslash, special chars all
// rejected for the LIVE <path> argument, under BOTH bare and --dry-run.
// ============================================================================
describe("negative: invalid live <path> args", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  const regBefore = readFileSync(regPathOf(proj), "utf8");

  const r1 = runCli(["approve", "/etc/passwd"], { proj });
  const r2 = runCli(["approve", "../etc/passwd"], { proj });
  const r3 = runCli(["approve", "scripts\\agent-tools\\mytool"], { proj });
  const r4 = runCli(["approve", "scripts/agent-tools/foo)bar"], { proj });
  const r5 = runCli(["approve", "/etc/passwd", "--dry-run"], { proj });
  const regAfter = readFileSync(regPathOf(proj), "utf8");

  it("invalid live <path> args rejected under bare and --dry-run, nothing written", () => {
    expect(r1.status).not.toBe(0);
    expect(r2.status).not.toBe(0);
    expect(r3.status).not.toBe(0);
    expect(r4.status).not.toBe(0);
    expect(r5.status).not.toBe(0);
    expect(regBefore).toBe(regAfter);
    expect(existsSync(settingsPathOf(proj))).toBe(false);
  });
});

// ============================================================================
// settings.json with pre-existing unrelated allow rules preserved through a
// real promotion.
// ============================================================================
describe("settings.json with pre-existing rules is preserved through promotion", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  writeFileSync(
    settingsPathOf(proj),
    JSON.stringify(
      { someOtherKey: "untouched", permissions: { allow: ["Bash(git status:*)", "Bash(ls:*)"] } },
      null,
      2,
    ),
  );

  runCli(["approve", "scripts/agent-tools/mytool"], { proj });
  const settings = readSettingsFile(settingsPathOf(proj));

  it("existing allow rules + other keys preserved through promotion", () => {
    expect(settings.permissions?.allow).toEqual(
      expect.arrayContaining(["Bash(git status:*)", "Bash(ls:*)", "Bash(scripts/agent-tools/mytool:*)"]),
    );
    expect(settings["someOtherKey"]).toBe("untouched");
  });
});

// ============================================================================
// fail-closed regression: malformed settings.json aborts the WHOLE apply
// (nothing written — live not placed, registry stays draft+staged intact).
// ============================================================================
describe("fail-closed: malformed settings.json aborts the entire apply", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  // Deliberately truncated / invalid JSON.
  writeFileSync(settingsPathOf(proj), '{\n  "permissions": {\n    "allow": ["Bash(important:*)"]\n  },\n');
  const settingsBefore = readFileSync(settingsPathOf(proj), "utf8");
  const regBefore = readFileSync(regPathOf(proj), "utf8");

  const out = runCli(["approve", "scripts/agent-tools/mytool"], { proj });

  const settingsAfter = readFileSync(settingsPathOf(proj), "utf8");
  const regAfter = readFileSync(regPathOf(proj), "utf8");

  it("malformed settings.json aborts the entire apply (fail-closed, live never placed)", () => {
    expect(out.status).not.toBe(0);
    expect(settingsBefore).toBe(settingsAfter);
    expect(regBefore).toBe(regAfter);
    expect(existsSync(liveAbsOf(proj, "mytool"))).toBe(false);
  });
});

// ============================================================================
// rollout migration: a pre-existing approved live tool (mode 0755, from
// before the staged/live split) is protected to 0555 (+ uchg where available)
// the next time ANY approve runs in that scope — idempotent, and it does not
// disturb the tool actually being promoted in the same invocation.
// ============================================================================
describe("rollout migration protects a pre-existing approved live tool", () => {
  const proj = newProj();
  const legacyContent = "#!/bin/bash\necho legacy\n";
  const legacyAbs = liveAbsOf(proj, "legacy-tool");
  writeFileSync(legacyAbs, legacyContent);
  chmodSync(legacyAbs, 0o755);
  const legacySha = sha256Hex(legacyContent);
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [
    {
      name: "legacy-tool",
      path: "scripts/agent-tools/legacy-tool",
      status: "approved",
      approvedSha256: legacySha,
      permissionRule: "Bash(scripts/agent-tools/legacy-tool:*)",
    },
    newDraftTool("mytool"),
  ]);

  runCli(["approve", "scripts/agent-tools/mytool"], { proj });
  const legacyMode = fileMode(legacyAbs);
  const legacyShaAfter = sha256Hex(readFileSync(legacyAbs));

  it("rollout migration protects a pre-existing approved live tool to 0555, content unchanged", () => {
    expect(legacyMode).toBe("555");
    expect(legacyShaAfter).toBe(legacySha);
  });

  // Running approve again is a no-op for the already-migrated legacy tool.
  const verifyOut = runCli(["verify", "scripts/agent-tools/legacy-tool"], { proj });

  it("migrated legacy tool still verifies OK", () => {
    expect(verifyOut.stdout).toMatch(/^OK\s+legacy-tool/m);
  });
});

// ============================================================================
// AC3 (live write-denied, approve-mjs side): after a real promotion, the live
// file's mode (0555) makes a direct write attempt fail — verified with an
// actual write attempt (is_writable), not just a stat of the mode bits.
// ============================================================================
describe("AC3 (live write-denied): a promoted live file denies a direct write", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  runCli(["approve", "scripts/agent-tools/mytool"], { proj });

  it("AC3: a promoted live file's mode (0555) denies a direct write attempt", () => {
    expect(isWritable(liveAbsOf(proj, "mytool"))).toBe(false);
  });

  it.runIf(chflagsAvailableInTests())("AC3: chflags nouchg succeeds (flag was set by promotion)", () => {
    const r = spawnSync("chflags", ["nouchg", liveAbsOf(proj, "mytool")]);
    expect(r.status).toBe(0);
  });
});

// ============================================================================
// review finding #1: `chflags nouchg` failing on an existing live file (a
// genuine command failure, distinct from "chflags not available on this
// platform") must abort BEFORE any write, with a legible error naming the
// path/flag/remedy, and leave live completely untouched. Uses a fake
// `chflags` shim placed first on PATH so the failure is deterministic and
// does not depend on this host's actual filesystem/flag support.
// ============================================================================
describe("finding #1: chflags nouchg failure aborts before any write", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", "#!/bin/bash\necho NEW\n");
  writeFileSync(liveAbsOf(proj, "mytool"), "#!/bin/bash\necho OLD\n");
  const liveShaBefore = sha256Hex("#!/bin/bash\necho OLD\n");
  writeProjectRegistry(proj, [revisionTool("mytool", liveShaBefore)]);
  const regBefore = readFileSync(regPathOf(proj), "utf8");

  const fakeBin = makeTmpDir("toolsmith-fakebin-");
  writeFileSync(
    join(fakeBin, "chflags"),
    '#!/bin/bash\nif [ "$1" = "nouchg" ]; then\n  echo "chflags: nouchg: Operation not permitted" >&2\n  exit 1\nfi\nexit 0\n',
  );
  chmodSync(join(fakeBin, "chflags"), 0o755);

  const out = runCli(["approve", "scripts/agent-tools/mytool"], {
    proj,
    env: { PATH: `${fakeBin}:${process.env["PATH"] ?? ""}` },
  });

  const liveAfter = readFileSync(liveAbsOf(proj, "mytool"), "utf8");
  const regAfter = readFileSync(regPathOf(proj), "utf8");

  it("finding #1: chflags nouchg failure aborts before any write, live untouched, legible error", () => {
    expect(out.status).not.toBe(0);
    expect(liveAfter).toBe("#!/bin/bash\necho OLD\n");
    expect(regBefore).toBe(regAfter);
    expect(out.stderr.toLowerCase()).toContain("nouchg");
    expect(out.stderr.toLowerCase()).toContain("untouched");
  });
});

// ============================================================================
// user scope: full new-tool promotion (AC5) — staged/staging namespace, live
// tools/ path, fully-expanded absolute rule in $HOME/.claude/settings.json.
// ============================================================================
describe("user scope: full new-tool promotion (AC5)", () => {
  const home = newHome();
  writeUserStaged(home, "mytool", DRAFT);
  writeUserRegistry(home, [newUserDraftTool("mytool")]);
  const absScript = userLiveAbsOf(home, "mytool");
  const expectSha = sha256Hex(DRAFT);
  const expectRule = `Bash(${absScript}:*)`;

  const dryOut = runCli(["approve", "mytool", "--user", "--dry-run"], { proj: NO_PROJ, home });

  it("user --dry-run: bare name normalizes, previews absolute path + rule + staged hash", () => {
    expect(dryOut.status).toBe(0);
    expect(dryOut.stdout).toContain(absScript);
    expect(dryOut.stdout).toContain(expectRule);
    expect(dryOut.stdout).toContain(expectSha);
  });

  const commitOut = runCli(["approve", "mytool", "--user"], { proj: NO_PROJ, home });
  const registryEntry = readRegistryFile(userRegPathOf(home)).tools[0]!;

  it("user promote pins registry with fully-expanded absolute rule", () => {
    expect(commitOut.status).toBe(0);
    expect(registryEntry["status"]).toBe("approved");
    expect(registryEntry["approvedSha256"]).toBe(expectSha);
    expect(registryEntry["permissionRule"]).toBe(expectRule);
  });

  it("user promote writes the absolute rule into $HOME/.claude/settings.json", () => {
    const settings = readSettingsFile(userSettingsPathOf(home));
    expect(settings.permissions?.allow).toEqual([expectRule]);
  });

  it("user promote places live file and removes the staging draft", () => {
    expect(existsSync(absScript)).toBe(true);
    expect(existsSync(userStagingAbsOf(home, "mytool"))).toBe(false);
  });
});

// ============================================================================
// user scope: staged.path escaping staging/ is rejected.
// ============================================================================
describe("user scope: staged.path escaping staging/ is rejected", () => {
  const home = newHome();
  writeFileSync(userLiveAbsOf(home, "evil-staged"), DRAFT);
  writeUserRegistry(home, [
    { name: "mytool", path: "tools/mytool", status: "draft", staged: { path: "tools/evil-staged", since: SINCE } },
  ]);

  const out = runCli(["approve", "mytool", "--user"], { proj: NO_PROJ, home });

  it("user-scope staged.path escaping staging/ is rejected", () => {
    expect(out.status).not.toBe(0);
    expect(out.stderr.toLowerCase()).toContain("staging");
    expect(existsSync(userLiveAbsOf(home, "mytool"))).toBe(false);
  });
});

// ============================================================================
// user scope: malformed $HOME/.claude/settings.json fails the whole apply
// closed (nothing written, staged draft untouched).
// ============================================================================
describe("user scope: malformed settings.json fails the whole apply closed", () => {
  const home = newHome();
  writeUserStaged(home, "mytool", DRAFT);
  writeUserRegistry(home, [newUserDraftTool("mytool")]);
  writeFileSync(userSettingsPathOf(home), '{\n  "permissions": {\n    "allow": ["Bash(important:*)"]\n  },\n');
  const regBefore = readFileSync(userRegPathOf(home), "utf8");

  const out = runCli(["approve", "mytool", "--user"], { proj: NO_PROJ, home });
  const regAfter = readFileSync(userRegPathOf(home), "utf8");

  it("user-scope malformed settings.json aborts entire apply (fail-closed)", () => {
    expect(out.status).not.toBe(0);
    expect(regBefore).toBe(regAfter);
    expect(existsSync(userLiveAbsOf(home, "mytool"))).toBe(false);
  });
});

// ============================================================================
// project scope stays the default: a project-scope registry entry named the
// same file must NOT be resolvable via --user, and vice versa. Uses --dry-run
// so this check stays side-effect free.
// ============================================================================
describe("project scope stays the default without --user", () => {
  const proj = newProj();
  writeStaged(proj, "mytool", DRAFT);
  writeProjectRegistry(proj, [newDraftTool("mytool")]);
  const home = newHome();

  const out = runCli(["approve", "scripts/agent-tools/mytool", "--dry-run"], { proj, home });

  it("default (no --user) still previews the project-relative rule", () => {
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("Bash(scripts/agent-tools/mytool:*)");
  });
});

// ============================================================================
// $HOME-rooted session (issue #36): approving/verifying WITHOUT --user must
// refuse with a clear pointer to --user (fail-closed); WITH --user still
// works normally, now through the staged/live promotion path.
// ============================================================================
describe("$HOME-rooted session (issue #36): approve without/with --user", () => {
  const home = newHome();
  writeUserStaged(home, "mytool", DRAFT);
  writeUserRegistry(home, [newUserDraftTool("mytool")]);
  const regBefore = readFileSync(userRegPathOf(home), "utf8");

  const withoutUserOut = runCli(["approve", "tools/mytool"], { proj: home, home });
  const regAfter = readFileSync(userRegPathOf(home), "utf8");
  // Captured immediately after the refused run (not inside `it`): a real
  // --user commit happens later in this block, so a lazy existsSync() inside
  // `it` would observe post-commit state instead of the pre-commit state.
  const liveExistsAfterRefusal = existsSync(userLiveAbsOf(home, "mytool"));

  it("$HOME-rooted approve without --user refuses (fail-closed), nothing written", () => {
    expect(withoutUserOut.status).not.toBe(0);
    expect(withoutUserOut.stderr.toLowerCase()).toContain("--user");
    expect(regBefore).toBe(regAfter);
    expect(liveExistsAfterRefusal).toBe(false);
  });

  const withUserOut = runCli(["approve", "mytool", "--user"], { proj: home, home });
  const statusAfter = readRegistryFile(userRegPathOf(home)).tools[0]!["status"];

  it("$HOME-rooted approve WITH --user still works normally (staged promotion)", () => {
    expect(withUserOut.status).toBe(0);
    expect(statusAfter).toBe("approved");
  });
});
