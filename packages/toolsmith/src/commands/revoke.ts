/**
 * `toolsmith revoke` — the symmetric demotion/retirement counterpart to
 * `approve` (docs/toolsmith/staged-live-split.md §Promotion, "Demotion/
 * retirement"; docs/toolsmith/attest-it-admission.md §Promotion integration:
 * "Revocation stays human-gated through the same ceremony; a revoked tool's
 * seal is not deleted... the registry state and live placement are what
 * change."). It runs its own safety-ordered apply manifest, deliberately in
 * the OPPOSITE order from promotion, so the standing capability is always
 * gone before the artifact:
 *
 *   1. remove the permissionRule from the scope's settings.json FIRST — the
 *      capability disappears before anything else changes, so there is
 *      never a window where an allow rule names a path that's about to stop
 *      being live;
 *   2. mark the registry entry status: "retired" — steering only ever
 *      treats a status:"approved" entry as registered (per the steering <->
 *      toolsmith contract), so flipping status away from "approved" IS the
 *      de-registration; there is no separate registration artifact to
 *      touch;
 *   3. clear the BSD immutable flag where available and remove the live
 *      file.
 *
 * Each step is independently idempotent (checks current state, only acts if
 * something remains to do), so revoking an already-retired or never-
 * registered tool converges to a clean no-op rather than an error, and a
 * kill mid-manifest never leaves a stale allow rule for a path whose
 * registration has already been removed.
 *
 * Retired entries are KEPT, not deleted — approvedSha256/permissionRule/
 * covers/etc. all survive so a tool's history stays auditable.
 *
 * Like approve, the commit run is a HUMAN act, run in the human's own
 * terminal — the toolsmith PreToolUse hook denies agent-run commit
 * invocations, and this command's help is written for that human. Agents
 * preview with --dry-run.
 */
import { existsSync, unlinkSync } from "node:fs";
import { atomicWrite, chflagsAvailable, readSettingsStrict, toJsonFile, tryChflags } from "../lib/fsutil.js";
import { isPlainObject, readJsonOrNull, readRegistry, type ToolEntry } from "../lib/registry.js";
import { resolveScope } from "../lib/scope.js";

/**
 * Test-only fault injection: exits immediately after the named apply step,
 * simulating a revoke killed mid-manifest so the regression suite can
 * assert the apply is idempotent. Never engages unless
 * TOOLSMITH_REVOKE_KILL_AFTER is set to that exact step name.
 */
function killAfter(step: string): void {
  if (process.env["TOOLSMITH_REVOKE_KILL_AFTER"] === step) {
    process.stderr.write(`[toolsmith-revoke test fault injection] killed after step "${step}"\n`);
    process.exit(9);
  }
}

export interface RevokeOptions {
  rawPath: string;
  commit: boolean;
  userScope: boolean;
}

export function runRevoke({ rawPath, commit, userScope }: RevokeOptions): number {
  const resolution = resolveScope(userScope);
  if (!resolution.ok) {
    process.stderr.write(resolution.error);
    return 1;
  }
  const scope = resolution.scope;

  const path = scope.normalize(rawPath);
  if (!path) {
    process.stderr.write(scope.invalidPathMessage(rawPath));
    return 1;
  }

  const regPath = scope.regPath;
  // Unlike approve/verify, a missing registry is not an error here: revoke's
  // goal state is "this tool is not registered, not granted, not live" — if
  // the registry doesn't exist at all, that goal state already holds
  // trivially. Idempotence, not strictness, governs the read side of revoke.
  if (!existsSync(regPath)) {
    process.stdout.write(`No registry found at ${regPath} — nothing to revoke (already absent).\n`);
    return 0;
  }

  const registry = readRegistry(regPath);
  if (!registry) {
    process.stderr.write(
      `Error: ${regPath} is not a valid registry (malformed JSON or missing "tools" array). Nothing written.\n`,
    );
    return 1;
  }

  const idx = registry.tools.findIndex((t) => t && t.path === path);
  if (idx === -1) {
    process.stdout.write(`No registry entry found for "${path}" — nothing to revoke (already absent).\n`);
    return 0;
  }
  const entry = registry.tools[idx]!;

  const liveAbs = scope.scriptAbs(path);
  const liveExistsNow = existsSync(liveAbs);
  const rule =
    typeof entry.permissionRule === "string" && entry.permissionRule ? entry.permissionRule : scope.ruleFor(path, liveAbs);
  const settingsFile = scope.settingsFile;
  const alreadyRetired = entry.status === "retired";

  if (!commit) {
    // Best-effort preview only — unlike approve's dry run, this never needs
    // to fail closed on a malformed settings.json, since nothing is written.
    const existingSettings = existsSync(settingsFile) ? readJsonOrNull(settingsFile) : {};
    const permissions = isPlainObject(existingSettings) ? existingSettings["permissions"] : undefined;
    const allowList = isPlainObject(permissions) && Array.isArray(permissions["allow"]) ? (permissions["allow"] as unknown[]) : null;
    const ruleGranted = allowList !== null && allowList.includes(rule);
    process.stdout.write(
      [
        `Tool: ${entry.name ?? "(unnamed)"}`,
        `Live path: ${scope.displayPath(path, liveAbs)}`,
        `Current status: ${entry.status ?? "(none)"}`,
        `Permission rule: ${rule}`,
        `Rule currently granted: ${ruleGranted ? "yes (would be removed)" : "no (already absent)"}`,
        `Live file present: ${liveExistsNow ? "yes (would be removed)" : "no (already absent)"}`,
        alreadyRetired && !ruleGranted && !liveExistsNow
          ? "Already fully retired — revoke would be a clean no-op."
          : "DRY RUN — nothing written; re-run without --dry-run to apply.",
      ].join("\n") + "\n",
    );
    return 0;
  }

  // --- commit: the apply manifest, executed in safety order ---------------

  // Step 1: remove the permissionRule from settings.json FIRST — the
  // capability must be gone before the artifact disappears, so there is
  // never a window where an allow rule grants a path that no longer exists.
  // Validate settings.json strictly before any write, same as approve: a
  // malformed settings.json aborts the ENTIRE revoke rather than skipping
  // past it, because we cannot safely prove the rule isn't present without
  // parsing it.
  const settingsCheck = readSettingsStrict(settingsFile);
  if (!settingsCheck.ok) {
    process.stderr.write(`Error: ${settingsCheck.reason} Nothing written.\n`);
    return 1;
  }
  const settingsBefore = settingsCheck.value;
  const permissionsBefore =
    settingsBefore["permissions"] && typeof settingsBefore["permissions"] === "object"
      ? (settingsBefore["permissions"] as Record<string, unknown>)
      : {};
  const allowBefore = Array.isArray(permissionsBefore["allow"]) ? (permissionsBefore["allow"] as unknown[]) : [];
  const ruleRemoved = allowBefore.includes(rule);
  if (ruleRemoved) {
    const allowAfter = allowBefore.filter((r) => r !== rule);
    atomicWrite(
      settingsFile,
      toJsonFile({
        ...settingsBefore,
        permissions: { ...permissionsBefore, allow: allowAfter },
      }),
    );
  }
  killAfter("revoke-rule");

  // Step 2: de-register + mark retired. Per the steering <-> toolsmith
  // contract, steering only ever treats a status:"approved" entry as
  // registered, so flipping status away from "approved" IS the
  // de-registration — there is no separate registration artifact to touch.
  // Provenance is kept, not scrubbed (approvedSha256/permissionRule/covers/
  // etc. all survive) — a retired entry's history remains auditable.
  const statusChanged = !alreadyRetired;
  if (statusChanged) {
    const retiredEntry: ToolEntry = { ...entry, status: "retired" };
    const toolsRetired = registry.tools.slice();
    toolsRetired[idx] = retiredEntry;
    atomicWrite(regPath, toJsonFile({ ...registry, tools: toolsRetired }));
  }
  killAfter("revoke-registry");

  // Step 3: chflags nouchg (only where chflags exists — its absence is a
  // known, graceful platform degradation, not an error) then remove the
  // live file. A genuine chflags failure (the binary exists but the command
  // itself fails) aborts here with a legible error — mirroring approve's own
  // distinction between "not available" and "failed" — but by this point the
  // rule is already gone and the entry is already retired, so the tool is
  // already unreachable via the standing grant either way; only the file
  // itself is left behind, not a live capability.
  let liveRemoved = false;
  if (liveExistsNow) {
    if (chflagsAvailable()) {
      const nouchgResult = tryChflags("nouchg", liveAbs);
      if (!nouchgResult.ok) {
        process.stderr.write(
          [
            `Error: could not clear the immutable flag before removing the live file.`,
            `  path: ${liveAbs}`,
            `  flag: uchg (chflags nouchg failed: ${nouchgResult.reason})`,
            `  State so far: the permission rule and registry registration are already removed —`,
            `  this tool cannot be invoked via the standing grant regardless. Only the on-disk file remains.`,
            `  Remedy: run \`chflags nouchg ${liveAbs}\` by hand to diagnose (permissions, ownership), then re-run revoke.`,
          ].join("\n") + "\n",
        );
        return 1;
      }
    }
    try {
      unlinkSync(liveAbs);
      liveRemoved = true;
    } catch (err) {
      process.stderr.write(
        [
          `Error: could not remove the live file: ${(err as Error).message}`,
          `  path: ${liveAbs}`,
          `  State so far: the permission rule and registry registration are already removed —`,
          `  this tool cannot be invoked via the standing grant regardless. Only the on-disk file remains.`,
          `  Remedy: remove ${liveAbs} by hand, then re-run revoke to confirm convergence.`,
        ].join("\n") + "\n",
      );
      return 1;
    }
  }
  killAfter("revoke-live");

  if (!ruleRemoved && !statusChanged && !liveRemoved) {
    process.stdout.write(`Already retired: ${entry.name ?? path} — nothing to do.\n`);
    return 0;
  }

  process.stdout.write(
    [
      `Revoked ${entry.name ?? "(unnamed)"} (${scope.displayPath(path, liveAbs)}):`,
      ruleRemoved
        ? `Removed rule from ${settingsFile} permissions.allow.`
        : `Rule already absent from ${settingsFile} (no-op).`,
      statusChanged ? `Registry entry marked status: retired.` : `Registry entry already status: retired (no-op).`,
      liveRemoved ? `Live file removed.` : `Live file already absent (no-op).`,
    ].join("\n") + "\n",
  );
  return 0;
}
