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
 *   2. if a registry entry exists, mark it status: "retired" — steering
 *      only ever treats a status:"approved" entry as registered (per the
 *      steering <-> toolsmith contract), so flipping status away from
 *      "approved" IS the de-registration; there is no separate
 *      registration artifact to touch, and no second write for it;
 *   3. clear the BSD immutable flag where available and remove the live
 *      file.
 *
 * Each step is independently idempotent (checks current state, only acts if
 * something remains to do), so revoking an already-retired or never-
 * registered tool converges to a clean no-op rather than an error, and a
 * kill mid-manifest never leaves a stale allow rule for a path whose
 * registration has already been removed.
 *
 * A registry entry is NOT a precondition for tearing down a standing grant:
 * an explicit `revoke <path>` honors the "never leave a stale grant"
 * invariant regardless of registry state. If the registry is missing
 * entirely, or has no entry for this path (manual edit, corruption, a
 * registry that was reset without going through revoke first), the rule is
 * derived from the path itself and any stale settings.json rule or lingering
 * live file is still torn down — there is just no registry entry left to
 * flip to "retired". Only a malformed (present-but-unparseable) registry is
 * a hard error, because in that case the entry's true state can't be proven
 * either way.
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
import { readRegistry, type Registry, type ToolEntry } from "../lib/registry.js";
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

  // A missing or malformed registry is NOT treated the same. Missing is a
  // legitimate state to revoke from (see the module doc above) — there is
  // just no entry to look up or retire. Malformed IS still a hard error: we
  // cannot safely prove there is no entry for this path without parsing it,
  // and a privileged, fail-closed command must refuse to guess.
  let registry: Registry | null = null;
  if (existsSync(regPath)) {
    registry = readRegistry(regPath);
    if (!registry) {
      process.stderr.write(
        `Error: ${regPath} is not a valid registry (malformed JSON or missing "tools" array). Nothing written.\n`,
      );
      return 1;
    }
  }

  const idx = registry ? registry.tools.findIndex((t) => t && t.path === path) : -1;
  const entry: ToolEntry | null = idx !== -1 ? registry!.tools[idx]! : null;
  const noRegistryEntryNote = registry
    ? `No registry entry found for "${path}"`
    : `No registry found at ${regPath}`;

  const liveAbs = scope.scriptAbs(path);
  const liveExistsNow = existsSync(liveAbs);
  // With no registry entry there is no trusted permissionRule to read — the
  // rule is derived the same way promotion computes it, from the path
  // itself, so a stale grant can still be found and torn down.
  const rule =
    typeof entry?.permissionRule === "string" && entry.permissionRule ? entry.permissionRule : scope.ruleFor(path, liveAbs);
  const settingsFile = scope.settingsFile;
  const alreadyRetired = entry?.status === "retired";

  if (!commit) {
    // Preview only, but it must not overclaim what it can determine: a
    // malformed settings.json means "rule granted?" is genuinely unknown,
    // not "no" — the commit run below fails closed on the same condition,
    // so the preview must say so plainly rather than implying it's already
    // absent.
    const settingsPreview = readSettingsStrict(settingsFile);
    let ruleGranted: boolean | null;
    if (!settingsPreview.ok) {
      ruleGranted = null;
    } else {
      const permissions =
        settingsPreview.value["permissions"] && typeof settingsPreview.value["permissions"] === "object"
          ? (settingsPreview.value["permissions"] as Record<string, unknown>)
          : {};
      const allowList = Array.isArray(permissions["allow"]) ? (permissions["allow"] as unknown[]) : null;
      ruleGranted = allowList !== null && allowList.includes(rule);
    }
    const ruleLine = !settingsPreview.ok
      ? `Permission rule: cannot determine (settings.json is malformed; revoke would fail closed and write nothing)`
      : `Permission rule: ${rule}\nRule currently granted: ${ruleGranted ? "yes (would be removed)" : "no (already absent)"}`;
    process.stdout.write(
      [
        entry ? `Tool: ${entry.name ?? "(unnamed)"}` : `${noRegistryEntryNote} — checking for an orphaned grant/live file.`,
        `Live path: ${scope.displayPath(path, liveAbs)}`,
        `Current status: ${entry?.status ?? "(no registry entry)"}`,
        ruleLine,
        `Live file present: ${liveExistsNow ? "yes (would be removed)" : "no (already absent)"}`,
        !settingsPreview.ok
          ? "DRY RUN — nothing written; the commit run would fail closed until settings.json is fixed."
          : (entry ? alreadyRetired : true) && ruleGranted === false && !liveExistsNow
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

  // Step 2: de-register + mark retired — only when there's a registry entry
  // to change. Per the steering <-> toolsmith contract, steering only ever
  // treats a status:"approved" entry as registered, so flipping status away
  // from "approved" IS the de-registration — there is no separate
  // registration artifact to touch, and thus no second write for it.
  // Provenance is kept, not scrubbed (approvedSha256/permissionRule/covers/
  // etc. all survive) — a retired entry's history remains auditable. With no
  // entry at all (orphaned grant/file, no registry record), this step is a
  // no-op by construction: there is nothing to retire, only the grant and
  // file to tear down in steps 1 and 3.
  const statusChanged = entry !== null && !alreadyRetired;
  if (statusChanged && registry) {
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
  // rule is already gone and the entry (if any) is already retired, so the
  // tool is already unreachable via the standing grant either way; only the
  // file itself is left behind, not a live capability.
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
    process.stdout.write(
      entry
        ? `Already retired: ${entry.name ?? path} — nothing to do.\n`
        : `${noRegistryEntryNote} — no stale grant or live file either. Nothing to do.\n`,
    );
    return 0;
  }

  process.stdout.write(
    [
      entry
        ? `Revoked ${entry.name ?? "(unnamed)"} (${scope.displayPath(path, liveAbs)}):`
        : `Tore down orphaned capability at ${scope.displayPath(path, liveAbs)} (no registry entry for this path):`,
      ruleRemoved
        ? `Removed rule from ${settingsFile} permissions.allow.`
        : `Rule already absent from ${settingsFile} (no-op).`,
      entry
        ? statusChanged
          ? `Registry entry marked status: retired.`
          : `Registry entry already status: retired (no-op).`
        : `No registry entry to update.`,
      liveRemoved ? `Live file removed.` : `Live file already absent (no-op).`,
    ].join("\n") + "\n",
  );
  return 0;
}
