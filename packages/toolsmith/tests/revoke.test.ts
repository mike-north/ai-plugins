/**
 * Regression tests for `toolsmith revoke` — the symmetric demotion/
 * retirement counterpart to `toolsmith approve`
 * (docs/toolsmith/staged-live-split.md §Promotion, "Demotion/retirement";
 * docs/toolsmith/attest-it-admission.md §"Promotion integration"). Mirrors
 * approve.test.ts's fixtures and conventions.
 *
 * Test-to-acceptance-criteria mapping (per the revoke brief this file
 * satisfies):
 *   1. rule removed FIRST, before status/file change  -> "AC1:" cases
 *   2. status -> retired (the de-registration)         -> "AC2:" cases
 *   3. live file removed (chflags nouchg where avail.)  -> "AC3:" cases
 *   4. registry entry kept, not deleted                -> "AC2:" cases (asserted alongside status)
 *   5. idempotent / fail-closed / clean no-op / tears     -> "AC4:" and "AC5:" cases
 *      down orphaned grants+files even with no registry
 *      entry to retire
 *   6. --dry-run writes nothing, reports accurately     -> "AC6:" cases
 *
 * @see docs/toolsmith/staged-live-split.md
 * @see docs/toolsmith/attest-it-admission.md
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupTmpDirs,
  fileMode,
  newHome,
  newProj,
  type RegistryToolInit,
  revisionTool,
  runCli,
  SINCE,
  sha256Hex,
  writeProjectRegistry,
  writeUserRegistry,
} from "./helpers.js";

afterAll(cleanupTmpDirs);

interface RegistryFile {
  version: number;
  tools: Array<Record<string, unknown>>;
}

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

const regPathOf = (proj: string): string => join(proj, ".claude", "toolsmith", "registry.json");
const settingsPathOf = (proj: string): string => join(proj, ".claude", "settings.json");
const liveAbsOf = (proj: string, name: string): string => join(proj, "scripts", "agent-tools", name);

const RULE = (name: string): string => `Bash(scripts/agent-tools/${name}:*)`;

/** An approved+live, fully-granted tool with no pending staged draft — the
 * baseline fixture for revoke (unlike approve.test.ts's revisionTool, this
 * one has no "staged" field, matching a tool that's simply in service). */
function liveApprovedTool(name: string, liveSha: string): RegistryToolInit {
  return {
    name,
    path: `scripts/agent-tools/${name}`,
    status: "approved",
    approvedSha256: liveSha,
    permissionRule: RULE(name),
  };
}

function writeGrantedSettings(proj: string, rule: string): void {
  writeFileSync(
    settingsPathOf(proj),
    JSON.stringify({ permissions: { allow: [rule] } }, null, 2) + "\n",
  );
}

const LIVE = "#!/bin/bash\necho hi\n";

function seedLiveTool(proj: string, name = "mytool"): { sha: string } {
  writeFileSync(liveAbsOf(proj, name), LIVE);
  const sha = sha256Hex(LIVE);
  writeProjectRegistry(proj, [liveApprovedTool(name, sha)]);
  writeGrantedSettings(proj, RULE(name));
  return { sha };
}

// ============================================================================
// AC1 (rule removed first): revoking a live, granted, approved tool removes
// the settings.json rule.
// ============================================================================
describe("AC1: revoke removes the permission rule from settings.json", () => {
  const proj = newProj();
  seedLiveTool(proj);

  const out = runCli(["revoke", "scripts/agent-tools/mytool"], { proj });

  it("AC1: revoke exits 0 and reports the rule removed", () => {
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("Removed rule from");
  });

  it("AC1: the rule is gone from settings.json permissions.allow", () => {
    expect(ruleCount(settingsPathOf(proj), RULE("mytool"))).toBe(0);
  });
});

// ============================================================================
// AC2: the registry entry's status becomes "retired" (this IS the steering
// de-registration — steering only honors status:"approved"), and the entry
// is KEPT (not deleted) so approvedSha256/permissionRule survive as an
// auditable record.
// ============================================================================
describe("AC2: registry entry marked retired, kept (not deleted), history intact", () => {
  const proj = newProj();
  const { sha } = seedLiveTool(proj);

  runCli(["revoke", "scripts/agent-tools/mytool"], { proj });
  const registryAfter = readRegistryFile(regPathOf(proj));

  it("AC2: exactly one entry remains (kept, not deleted)", () => {
    expect(registryAfter.tools).toHaveLength(1);
  });

  it("AC2: status is retired", () => {
    expect(registryAfter.tools[0]!["status"]).toBe("retired");
  });

  it("AC2: approvedSha256 and permissionRule survive as history", () => {
    expect(registryAfter.tools[0]!["approvedSha256"]).toBe(sha);
    expect(registryAfter.tools[0]!["permissionRule"]).toBe(RULE("mytool"));
  });
});

// ============================================================================
// AC3: the live file is removed (and, where chflags exists, its immutable
// flag is cleared first so the unlink can succeed at all).
// ============================================================================
describe("AC3: revoke removes the live file", () => {
  const proj = newProj();
  seedLiveTool(proj);
  // Captured immediately (not inside `it`): the revoke call below is a real
  // synchronous statement in this describe body, executed at collection
  // time before ANY `it` callback runs — a lazy existsSync() inside `it`
  // would observe post-revoke state instead of the pre-revoke state under
  // test.
  const liveExistsBeforeRevoke = existsSync(liveAbsOf(proj, "mytool"));

  it("AC3: live file exists before revoke", () => {
    expect(liveExistsBeforeRevoke).toBe(true);
  });

  const out = runCli(["revoke", "scripts/agent-tools/mytool"], { proj });

  it("AC3: revoke reports the live file removed", () => {
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("Live file removed.");
  });

  it("AC3: live file is gone from disk", () => {
    expect(existsSync(liveAbsOf(proj, "mytool"))).toBe(false);
  });
});

// ============================================================================
// AC4 (idempotent / fail-closed): revoking an already-retired tool is a
// clean no-op — exit 0, no error, nothing further changes.
// ============================================================================
describe("AC4: revoking an already-retired tool is a clean no-op", () => {
  const proj = newProj();
  seedLiveTool(proj);
  runCli(["revoke", "scripts/agent-tools/mytool"], { proj });
  const registryAfterFirst = readRegistryFile(regPathOf(proj));

  const secondOut = runCli(["revoke", "scripts/agent-tools/mytool"], { proj });
  const registryAfterSecond = readRegistryFile(regPathOf(proj));

  it("AC4: second revoke exits 0 and reports nothing to do", () => {
    expect(secondOut.status).toBe(0);
    expect(secondOut.stdout.toLowerCase()).toContain("already retired");
  });

  it("AC4: registry entry is unchanged by the second revoke", () => {
    expect(registryAfterSecond).toEqual(registryAfterFirst);
  });

  it("AC4: no rule was re-added by the second revoke", () => {
    expect(ruleCount(settingsPathOf(proj), RULE("mytool"))).toBe(0);
  });
});

// ============================================================================
// AC4 (continued): a missing registry, or a registry with no entry for the
// path, is NOT assumed to imply "nothing granted" — a stale settings.json
// rule or a lingering live file can outlive the registry entry that once
// governed them (manual edit, corruption, a reset registry). revoke must
// still tear those down, in the same safety order, even with no entry to
// flip to "retired". Only when the registry state is absent AND no rule AND
// no live file exist is it a genuine clean no-op.
// ============================================================================
describe("AC4 (continued): revoke tears down orphaned grants/files even with no registry entry", () => {
  it("AC4(a): missing registry file but a stale rule + live file present -> both removed", () => {
    const proj = newProj();
    // Deliberately no registry.json at all.
    writeFileSync(liveAbsOf(proj, "orphan"), LIVE);
    writeGrantedSettings(proj, RULE("orphan"));

    const out = runCli(["revoke", "scripts/agent-tools/orphan"], { proj });

    expect(out.status).toBe(0);
    expect(out.stdout).toContain("Removed rule from");
    expect(out.stdout).toContain("Live file removed.");
    expect(ruleCount(settingsPathOf(proj), RULE("orphan"))).toBe(0);
    expect(existsSync(liveAbsOf(proj, "orphan"))).toBe(false);
  });

  it("AC4(b): entry not found in an existing registry but a stale rule is present -> rule removed", () => {
    const proj = newProj();
    writeProjectRegistry(proj, [{ name: "other", path: "scripts/agent-tools/other", status: "draft" }]);
    writeGrantedSettings(proj, RULE("orphan-b"));

    const out = runCli(["revoke", "scripts/agent-tools/orphan-b"], { proj });

    expect(out.status).toBe(0);
    expect(out.stdout).toContain("Removed rule from");
    expect(ruleCount(settingsPathOf(proj), RULE("orphan-b"))).toBe(0);
    // The unrelated entry is untouched.
    expect(readRegistryFile(regPathOf(proj)).tools).toHaveLength(1);
    expect(readRegistryFile(regPathOf(proj)).tools[0]!["name"]).toBe("other");
  });

  it("AC4(c): no registry entry, no rule, no live file -> genuine clean no-op", () => {
    const proj = newProj();
    writeProjectRegistry(proj, []);
    const out = runCli(["revoke", "scripts/agent-tools/nope"], { proj });
    expect(out.status).toBe(0);
    expect(out.stdout.toLowerCase()).toContain("nothing to do");
  });

  it("AC4(c continued): no registry file at all, no rule, no live file -> genuine clean no-op", () => {
    const proj = newProj();
    const out = runCli(["revoke", "scripts/agent-tools/nope"], { proj });
    expect(out.status).toBe(0);
    expect(out.stdout.toLowerCase()).toContain("nothing to do");
  });
});

// ============================================================================
// AC5 (fail-closed convergence): a kill immediately after the rule-removal
// step must leave the tool's registration and live file still in place (the
// rule alone is gone) — never a state where the file is deleted but the
// grant remains, or vice versa outside the defined order. A re-run then
// converges to fully retired.
// ============================================================================
describe("AC5: kill after rule removal converges to fully retired on re-run", () => {
  const proj = newProj();
  seedLiveTool(proj);

  const killOut = runCli(["revoke", "scripts/agent-tools/mytool"], {
    proj,
    env: { TOOLSMITH_REVOKE_KILL_AFTER: "revoke-rule" },
  });
  const statusAfterKill = readRegistryFile(regPathOf(proj)).tools[0]!["status"];
  const ruleAfterKill = ruleCount(settingsPathOf(proj), RULE("mytool"));
  const liveExistsAfterKill = existsSync(liveAbsOf(proj, "mytool"));

  it("AC5: killed right after the rule is removed: rule gone, but status/file untouched yet", () => {
    expect(killOut.status).not.toBe(0);
    expect(ruleAfterKill).toBe(0);
    expect(statusAfterKill).toBe("approved");
    expect(liveExistsAfterKill).toBe(true);
  });

  const convergeOut = runCli(["revoke", "scripts/agent-tools/mytool"], { proj });
  const registryAfterConverge = readRegistryFile(regPathOf(proj)).tools[0]!;

  it("AC5: re-running after the kill converges to fully retired", () => {
    expect(convergeOut.status).toBe(0);
    expect(registryAfterConverge["status"]).toBe("retired");
    expect(existsSync(liveAbsOf(proj, "mytool"))).toBe(false);
    expect(ruleCount(settingsPathOf(proj), RULE("mytool"))).toBe(0);
  });
});

// ============================================================================
// AC5 (continued): kill after the registry write (status already retired,
// rule already gone) still leaves the live file in place; re-run removes it
// and reports a clean, idempotent finish (no re-write of an already-retired
// status).
// ============================================================================
describe("AC5 (continued): kill after registry write converges on re-run", () => {
  const proj = newProj();
  seedLiveTool(proj);

  const killOut = runCli(["revoke", "scripts/agent-tools/mytool"], {
    proj,
    env: { TOOLSMITH_REVOKE_KILL_AFTER: "revoke-registry" },
  });
  // Captured immediately after the kill (not inside `it`): the converging
  // revoke run below is the very next statement in this describe body and
  // runs at collection time before any `it` callback — a lazy check inside
  // `it` would observe post-convergence state instead.
  const statusAfterKill = readRegistryFile(regPathOf(proj)).tools[0]!["status"];
  const ruleCountAfterKill = ruleCount(settingsPathOf(proj), RULE("mytool"));
  const liveExistsAfterKill = existsSync(liveAbsOf(proj, "mytool"));

  it("AC5: killed after the registry write: rule gone, status retired, file still live", () => {
    expect(killOut.status).not.toBe(0);
    expect(ruleCountAfterKill).toBe(0);
    expect(statusAfterKill).toBe("retired");
    expect(liveExistsAfterKill).toBe(true);
  });

  const convergeOut = runCli(["revoke", "scripts/agent-tools/mytool"], { proj });

  it("AC5: re-running removes the now-orphaned live file and finishes cleanly", () => {
    expect(convergeOut.status).toBe(0);
    expect(existsSync(liveAbsOf(proj, "mytool"))).toBe(false);
  });
});

// ============================================================================
// AC6 (--dry-run): writes nothing; reports name, current status, the exact
// rule that would be removed, and whether the live file would be removed.
// ============================================================================
describe("AC6: --dry-run writes nothing and previews accurately", () => {
  const proj = newProj();
  seedLiveTool(proj);
  const regBefore = readFileSync(regPathOf(proj), "utf8");
  const settingsBefore = readFileSync(settingsPathOf(proj), "utf8");

  const out = runCli(["revoke", "scripts/agent-tools/mytool", "--dry-run"], { proj });

  it("AC6: dry-run exits 0 and writes nothing to the registry or settings", () => {
    expect(out.status).toBe(0);
    expect(readFileSync(regPathOf(proj), "utf8")).toBe(regBefore);
    expect(readFileSync(settingsPathOf(proj), "utf8")).toBe(settingsBefore);
  });

  it("AC6: dry-run reports name, current status, rule, and live-file-present", () => {
    expect(out.stdout).toContain("Tool: mytool");
    expect(out.stdout).toContain("Current status: approved");
    expect(out.stdout).toContain(RULE("mytool"));
    expect(out.stdout).toContain("would be removed");
    expect(out.stdout.toLowerCase()).toContain("dry run");
  });

  it("AC6: live file still present after dry-run", () => {
    expect(existsSync(liveAbsOf(proj, "mytool"))).toBe(true);
  });
});

// ============================================================================
// AC6 (continued): --dry-run against an already-retired tool reports it as
// already a no-op, not as pending work.
// ============================================================================
describe("AC6 (continued): --dry-run on an already-retired tool reports no-op", () => {
  const proj = newProj();
  seedLiveTool(proj);
  runCli(["revoke", "scripts/agent-tools/mytool"], { proj });

  const out = runCli(["revoke", "scripts/agent-tools/mytool", "--dry-run"], { proj });

  it("AC6: dry-run on a retired tool reports it's already a clean no-op", () => {
    expect(out.status).toBe(0);
    expect(out.stdout.toLowerCase()).toContain("already fully retired");
  });
});

// ============================================================================
// AC6 (continued): --dry-run against a malformed settings.json must not
// claim the rule is "already absent" — it genuinely cannot be determined
// without a successful parse, and the commit run fails closed on exactly
// this condition. The preview must say so, not overclaim a clean state.
// ============================================================================
describe("AC6 (continued): --dry-run reports the fail-closed condition on malformed settings.json, never 'already absent'", () => {
  const proj = newProj();
  seedLiveTool(proj);
  writeFileSync(settingsPathOf(proj), "not valid json {{{");

  const out = runCli(["revoke", "scripts/agent-tools/mytool", "--dry-run"], { proj });

  it("AC6: dry-run on malformed settings.json reports 'cannot determine', not 'already absent'", () => {
    expect(out.status).toBe(0);
    expect(out.stdout.toLowerCase()).toContain("cannot determine");
    expect(out.stdout.toLowerCase()).toContain("fail closed");
    expect(out.stdout).not.toContain("already absent");
  });

  it("AC6: dry-run on malformed settings.json still writes nothing", () => {
    expect(readFileSync(settingsPathOf(proj), "utf8")).toBe("not valid json {{{");
  });
});

// ============================================================================
// A tool with a pending staged draft is still revocable: revoke only ever
// touches the live path, the settings rule, and status — never the "staged"
// field. This is a distinct concern from AC2 above, so its own describe.
// ============================================================================
describe("revoke leaves an unrelated pending staged draft untouched", () => {
  const proj = newProj();
  writeFileSync(liveAbsOf(proj, "mytool"), LIVE);
  const sha = sha256Hex(LIVE);
  writeProjectRegistry(proj, [revisionTool("mytool", sha)]);
  writeGrantedSettings(proj, RULE("mytool"));

  runCli(["revoke", "scripts/agent-tools/mytool"], { proj });
  const entry = readRegistryFile(regPathOf(proj)).tools[0]!;

  it("staged field survives revoke untouched", () => {
    expect(Object.hasOwn(entry, "staged")).toBe(true);
  });

  it("status is still retired", () => {
    expect(entry["status"]).toBe("retired");
  });
});

// ============================================================================
// --user scope: same behavior, resolved against the user registry/settings.
// ============================================================================
describe("--user scope: revoke resolves against the user registry", () => {
  const home = newHome();
  const NO_PROJ = "/nonexistent-should-not-be-used";
  const userLiveAbsOf = (h: string, name: string): string => join(h, ".claude", "toolsmith", "tools", name);
  const userRegPathOf = (h: string): string => join(h, ".claude", "toolsmith", "registry.json");
  const userSettingsPathOf = (h: string): string => join(h, ".claude", "settings.json");

  writeFileSync(userLiveAbsOf(home, "mytool"), LIVE);
  const sha = sha256Hex(LIVE);
  const abs = userLiveAbsOf(home, "mytool");
  const rule = `Bash(${abs}:*)`;
  writeUserRegistry(home, [
    { name: "mytool", path: "tools/mytool", status: "approved", approvedSha256: sha, permissionRule: rule },
  ]);
  writeFileSync(userSettingsPathOf(home), JSON.stringify({ permissions: { allow: [rule] } }, null, 2) + "\n");

  const out = runCli(["revoke", "mytool", "--user"], { proj: NO_PROJ, home });

  it("--user: revoke removes the rule, retires the entry, and removes the live file", () => {
    expect(out.status).toBe(0);
    expect(existsSync(userLiveAbsOf(home, "mytool"))).toBe(false);
    expect(readRegistryFile(userRegPathOf(home)).tools[0]!["status"]).toBe("retired");
    const settings = readSettingsFile(userSettingsPathOf(home));
    expect(settings.permissions?.allow ?? []).not.toContain(rule);
  });
});

// ============================================================================
// negative: malformed settings.json aborts the entire revoke fail-closed —
// nothing written, including no registry change, since the rule-removal
// step runs first and cannot safely prove the rule's absence.
// ============================================================================
describe("negative: malformed settings.json aborts revoke fail-closed", () => {
  const proj = newProj();
  seedLiveTool(proj);
  writeFileSync(settingsPathOf(proj), "not valid json {{{");
  const regBefore = readFileSync(regPathOf(proj), "utf8");

  const out = runCli(["revoke", "scripts/agent-tools/mytool"], { proj });

  it("malformed settings.json: revoke refuses, registry untouched", () => {
    expect(out.status).not.toBe(0);
    expect(out.stderr.toLowerCase()).toContain("not valid json");
    expect(readFileSync(regPathOf(proj), "utf8")).toBe(regBefore);
    expect(existsSync(liveAbsOf(proj, "mytool"))).toBe(true);
  });
});

// ============================================================================
// negative: malformed registry.json is a hard error (distinct from "absent",
// which is a clean no-op) — the tool cannot safely determine the entry's
// current state.
// ============================================================================
describe("negative: malformed registry.json is a hard error, not a no-op", () => {
  const proj = newProj();
  writeFileSync(regPathOf(proj), "not valid json {{{", "utf8");

  const out = runCli(["revoke", "scripts/agent-tools/mytool"], { proj });

  it("malformed registry: revoke refuses with a clear error", () => {
    expect(out.status).not.toBe(0);
    expect(out.stderr.toLowerCase()).toContain("not a valid registry");
  });
});

// ============================================================================
// A live file promoted through the real `approve` flow (mode 0555 + BSD
// immutable flag where available) is still removable by revoke — the
// nouchg-before-unlink step must actually clear the flag that `approve` set,
// not merely handle files that were never protected in the first place.
// ============================================================================
describe("revoke removes a live file protected by a real promotion (mode 0555 + uchg)", () => {
  const proj = newProj();
  writeFileSync(join(proj, ".claude", "toolsmith", "staging", "mytool"), LIVE);
  writeProjectRegistry(proj, [
    {
      name: "mytool",
      path: "scripts/agent-tools/mytool",
      status: "draft",
      staged: { path: ".claude/toolsmith/staging/mytool", since: SINCE },
    },
  ]);
  runCli(["approve", "scripts/agent-tools/mytool"], { proj });
  // Captured immediately after approve (not inside `it`): the revoke call
  // below is the very next statement in this describe body and runs at
  // collection time before any `it` callback — a lazy fileMode() inside
  // `it` would observe the post-revoke (removed) file instead.
  const modeAfterApprove = fileMode(liveAbsOf(proj, "mytool"));

  it("promoted live file is mode 0555", () => {
    expect(modeAfterApprove).toBe("555");
  });

  const out = runCli(["revoke", "scripts/agent-tools/mytool"], { proj });

  it("revoke clears the write-denial flag and removes the file", () => {
    expect(out.status).toBe(0);
    expect(existsSync(liveAbsOf(proj, "mytool"))).toBe(false);
  });
});
