/**
 * `toolsmith approve` — the one trust boundary (docs/toolsmith/cli-surface.md
 * §Verbs): promotes an agent-authored staging draft into the tool's live path
 * as a deterministic apply manifest (nouchg -> atomic place -> chmod 0555 +
 * uchg -> recompute+pin -> grant rule -> clear staged -> remove the staging
 * file), per docs/toolsmith/staged-live-split.md §Promotion.
 *
 * The commit run is a HUMAN act, run in the human's own terminal — the
 * toolsmith PreToolUse hook denies agent-run commit invocations, and this
 * command's help is written for that human. Agents preview with --dry-run.
 *
 * Fail-closed: any validation failure before the apply begins exits non-zero
 * and writes nothing; a failure mid-apply leaves live refused-closed (its pin
 * won't match) until a re-run, and the apply is idempotent so a re-run
 * converges rather than double-applying.
 */
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import {
  atomicWrite,
  chflagsAvailable,
  readSettingsStrict,
  sha256OfBytes,
  toJsonFile,
  tryChflags,
} from "../lib/fsutil.js";
import { unifiedLineDiff } from "../lib/diff.js";
import { readRegistry, type Registry, type ToolEntry } from "../lib/registry.js";
import { resolveScope, type Scope } from "../lib/scope.js";
import { lintGate, renderLintReport } from "./lint.js";

/**
 * Test-only fault injection: exits immediately after the named apply step,
 * simulating a promotion killed mid-manifest so the regression suite can
 * assert the apply is idempotent (staged-live-split.md AC4). Never engages
 * unless TOOLSMITH_APPROVE_KILL_AFTER is set to that exact step name.
 */
function killAfter(step: string): void {
  if (process.env["TOOLSMITH_APPROVE_KILL_AFTER"] === step) {
    process.stderr.write(`[toolsmith-approve test fault injection] killed after step "${step}"\n`);
    process.exit(9);
  }
}

/**
 * Test-only fault injection: clobbers the on-disk registry with invalid JSON
 * immediately before step 6 re-reads it, simulating a concurrent edit or
 * corruption between step 4's pin-write and step 6's read. Never engages
 * unless TOOLSMITH_APPROVE_CORRUPT_REGISTRY_STEP6 is set.
 */
function maybeCorruptRegistryForTest(regPath: string): void {
  if (process.env["TOOLSMITH_APPROVE_CORRUPT_REGISTRY_STEP6"] === "1") {
    writeFileSync(regPath, "not valid json {{{ this simulates corruption", "utf8");
  }
}

/**
 * Rollout migration (docs/toolsmith/staged-live-split.md §Rollout): apply
 * write-denial layer 1 (0555 + uchg) to every already-approved live tool in
 * this scope that predates the staged/live split. Idempotent and best-effort
 * per file — a single unreadable/missing tool is reported, never aborts the
 * promotion the caller actually asked for.
 */
function migrateProtection(registry: Registry, scope: Scope): string[] {
  const notes: string[] = [];
  for (const tool of registry.tools) {
    if (!tool || tool.status !== "approved" || typeof tool.path !== "string") continue;
    const normalized = scope.normalize(tool.path);
    if (!normalized) continue;
    const abs = scope.scriptAbs(normalized);
    if (!existsSync(abs)) continue;
    let mode: number;
    try {
      mode = statSync(abs).mode & 0o777;
    } catch {
      continue;
    }
    if (mode === 0o555) continue; // already protected — nothing to do
    try {
      chmodSync(abs, 0o555);
    } catch (err) {
      notes.push(`Warning: could not protect pre-existing live tool ${abs}: ${(err as Error).message}`);
      continue;
    }
    const flagResult = tryChflags("uchg", abs);
    notes.push(
      flagResult.ok
        ? `Migrated pre-existing live tool ${abs} to 0555 + uchg.`
        : `Migrated pre-existing live tool ${abs} to 0555 (uchg unavailable: ${flagResult.reason}).`,
    );
  }
  return notes;
}

export interface ApproveOptions {
  rawPath: string;
  commit: boolean;
  userScope: boolean;
}

export function runApprove({ rawPath, commit, userScope }: ApproveOptions): number {
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
  if (!existsSync(regPath)) {
    process.stderr.write(
      `Error: no registry found at ${regPath}. Create a draft entry first — see ` +
        `skills/toolsmith/references/registry-schema.md. Nothing written.\n`,
    );
    return 1;
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
    process.stderr.write(
      `Error: no registry entry found with path "${path}". This tool only pins the hash and ` +
        `grants the permission — it does not invent name/purpose/args/scope/covers. Author a ` +
        `draft entry first (see skills/toolsmith/references/registry-schema.md). Nothing written.\n`,
    );
    return 1;
  }
  const entry = registry.tools[idx]!;

  // The entry MUST carry a staged draft — promotion always moves bytes FROM
  // staging TO live; nothing is ever authored directly at the live path.
  const staged = entry.staged;
  if (!staged || typeof staged !== "object" || typeof staged.path !== "string") {
    process.stderr.write(
      `Error: registry entry "${path}" has no "staged" draft to promote. Author the draft under ` +
        `the staging namespace and add a "staged" field to the entry first — see ` +
        `skills/toolsmith/references/registry-schema.md. Nothing written.\n`,
    );
    return 1;
  }
  const stagedRelPath = scope.normalizeStaged(staged.path);
  if (!stagedRelPath) {
    process.stderr.write(scope.invalidStagedPathMessage(staged.path));
    return 1;
  }
  const stagedAbs = scope.stagedAbs(stagedRelPath);
  if (!existsSync(stagedAbs)) {
    process.stderr.write(`Error: staged draft not found at ${stagedAbs}. Nothing written.\n`);
    return 1;
  }

  let stagedBytes: Buffer;
  try {
    stagedBytes = readFileSync(stagedAbs);
  } catch (err) {
    process.stderr.write(`Error: could not read ${stagedAbs}: ${(err as Error).message}. Nothing written.\n`);
    return 1;
  }
  const stagedSha = sha256OfBytes(stagedBytes);

  // Promotion gate (staged-live-split.md §Promotion step 1): lint the staged
  // draft with the SAME gate `toolsmith lint` runs — never a second, looser
  // check (cli-surface.md §Verbs). Errors refuse the promotion (and the
  // preview: a draft that cannot be promoted should say so at --dry-run
  // time, before a human ever reads the review surface); warnings surface in
  // the review output but do not block.
  const lint = lintGate(stagedBytes, stagedAbs);
  if (lint.errors.length > 0) {
    process.stderr.write(
      `Error: the staged draft fails the proposal gate (toolsmith lint). Fix it in staging and re-run.\n` +
        renderLintReport(lint) +
        `Nothing written.\n`,
    );
    return 1;
  }
  const lintNotes = lint.warnings.map((w) => `Lint warning: ${w.rule}: ${w.message}`);

  const liveAbs = scope.scriptAbs(path);
  const isRevision = existsSync(liveAbs);
  let liveTextBefore = "";
  if (isRevision) {
    try {
      liveTextBefore = readFileSync(liveAbs, "utf8");
    } catch {
      liveTextBefore = "";
    }
  }

  const rule = scope.ruleFor(path, liveAbs);
  const settingsFile = scope.settingsFile;
  // Tri-state for the preview: "yes"/"no" when settings.json is readable (or
  // absent), "unknown" when it exists but is malformed — the commit run will
  // refuse fail-closed on a malformed settings.json, so the preview must not
  // present it as a clean "no".
  const settingsExists = existsSync(settingsFile);
  const existingSettings = settingsExists
    ? (readRegistrylike(settingsFile) as { permissions?: { allow?: unknown } } | null)
    : {};
  const settingsMalformed = settingsExists && existingSettings === null;
  const allowList =
    existingSettings && Array.isArray(existingSettings.permissions?.allow)
      ? (existingSettings.permissions.allow as unknown[])
      : null;
  const alreadyGranted = allowList !== null && allowList.includes(rule);

  if (!commit) {
    const reviewSurface = isRevision
      ? unifiedLineDiff(liveTextBefore, stagedBytes.toString("utf8"))
      : stagedBytes.toString("utf8");
    process.stdout.write(
      [
        `Tool: ${entry.name ?? "(unnamed)"}`,
        `Kind: ${isRevision ? "revision (diff against current live)" : "new tool (full text)"}`,
        `Live path: ${scope.displayPath(path, liveAbs)}`,
        `Staged draft: ${staged.path}${staged.note ? ` — ${staged.note}` : ""}`,
        `Computed sha256 (staged): ${stagedSha}`,
        `Permission rule: ${rule}`,
        `Already in settings.json: ${
          settingsMalformed
            ? "unknown (settings.json is not valid JSON — the commit run will refuse until it is fixed)"
            : alreadyGranted
              ? "yes"
              : "no"
        }`,
        ...lintNotes,
        "",
        "--- review surface ---",
        reviewSurface,
        "--- end review surface ---",
        "",
        "DRY RUN — nothing written; re-run without --dry-run to apply.",
      ].join("\n") + "\n",
    );
    return 0;
  }

  // --- commit: the apply manifest, executed deterministically -------------
  // Validate settings.json BEFORE any write, so a malformed/non-object
  // settings.json aborts the *entire* apply rather than placing live and then
  // clobbering settings.json.
  const settingsCheck = readSettingsStrict(settingsFile);
  if (!settingsCheck.ok) {
    process.stderr.write(`Error: ${settingsCheck.reason} Nothing written.\n`);
    return 1;
  }

  // Rollout migration (§Rollout): protect any pre-existing approved live
  // tools in this scope that predate the split. Never aborts this promotion
  // on a per-file failure.
  const migrationNotes = migrateProtection(registry, scope);

  // Step 1: nouchg the live path, if it exists and carries the flag from a
  // prior promotion. A genuine `chflags nouchg` failure on a platform that
  // HAS the binary aborts BEFORE any write with a legible, actionable error;
  // chflags being absent entirely is a known graceful degradation.
  if (isRevision && chflagsAvailable()) {
    const nouchgResult = tryChflags("nouchg", liveAbs);
    if (!nouchgResult.ok) {
      process.stderr.write(
        [
          `Error: could not clear the immutable flag before promotion.`,
          `  path: ${liveAbs}`,
          `  flag: uchg (chflags nouchg failed: ${nouchgResult.reason})`,
          `  Live is untouched — nothing was written.`,
          `  Remedy: run \`chflags nouchg ${liveAbs}\` by hand to diagnose (permissions, ownership), then re-run approve.`,
        ].join("\n") + "\n",
      );
      return 1;
    }
  }
  killAfter("nouchg");

  // Step 2: atomic place — the rename itself is atomic, so a thrown error
  // here means it did NOT happen: live is exactly as it was before.
  try {
    atomicWrite(liveAbs, stagedBytes);
  } catch (err) {
    process.stderr.write(
      `Error: could not place the staged bytes at ${liveAbs}: ${(err as Error).message}. ` +
        `The place step is atomic (write to a temp file, then rename) — it either fully happens or not at all, ` +
        `and it did not: live is unchanged. Fix the underlying issue (disk space, parent directory permissions) and re-run approve.\n`,
    );
    return 1;
  }
  killAfter("place");

  // Step 3: chmod 0555 (r-x, no write bit) + uchg (best-effort BSD immutable
  // flag) — write-denial layer 1. By this point the new bytes are placed but
  // the registry pin has not been updated, so invocation already fails closed
  // (layer 3) on its own; state that honestly rather than crashing.
  try {
    chmodSync(liveAbs, 0o555);
  } catch (err) {
    process.stderr.write(
      `Error: staged bytes were placed at ${liveAbs} but chmod 0555 failed: ${(err as Error).message}. ` +
        `Live now holds the new bytes but is neither mode-protected nor re-pinned; its hash no longer matches ` +
        `the registered pin, so invocation already fails closed. Re-run approve to converge.\n`,
    );
    return 1;
  }
  const uchgResult = tryChflags("uchg", liveAbs);
  killAfter("mode");

  // Step 4: recompute the pin from the bytes actually PLACED on disk — never
  // trust the staged.sha256 bookkeeping field or the sha computed before the
  // write (time-of-check != time-of-use guard).
  let placedBytes: Buffer;
  try {
    placedBytes = readFileSync(liveAbs);
  } catch (err) {
    process.stderr.write(
      `Error: promotion placed ${liveAbs} but it could not be re-read to pin the hash: ${(err as Error).message}. ` +
        `Live is now in an unpinned state — re-run approve to converge.\n`,
    );
    return 1;
  }
  const placedSha = sha256OfBytes(placedBytes);

  const pinnedEntry: ToolEntry = {
    ...entry,
    status: "approved",
    approvedSha256: placedSha,
    permissionRule: rule,
  };
  const toolsWithPin = registry.tools.slice();
  toolsWithPin[idx] = pinnedEntry;
  atomicWrite(regPath, toJsonFile({ ...registry, tools: toolsWithPin }));
  killAfter("pin");

  // Step 5: ensure the permission rule is granted in the scope's settings.json.
  const settingsBefore = settingsCheck.value;
  const permissionsBefore =
    settingsBefore["permissions"] && typeof settingsBefore["permissions"] === "object"
      ? (settingsBefore["permissions"] as Record<string, unknown>)
      : {};
  const allowBefore = Array.isArray(permissionsBefore["allow"]) ? (permissionsBefore["allow"] as unknown[]) : [];
  const allowAfter = allowBefore.includes(rule) ? allowBefore : [...allowBefore, rule];
  atomicWrite(
    settingsFile,
    toJsonFile({
      ...settingsBefore,
      permissions: { ...permissionsBefore, allow: allowAfter },
    }),
  );
  killAfter("rule");

  // Step 6: clear "staged" from the registry entry (a second registry write)
  // and remove the staging file. Re-read the registry from disk in case a
  // concurrent process touched other entries; if the re-read comes back
  // corrupted, fall back to the in-memory state from step 4 rather than
  // throwing — the tool is already placed, pinned, and granted, so step 6
  // must degrade gracefully, not crash.
  maybeCorruptRegistryForTest(regPath);
  let registryAfterRule = readRegistry(regPath);
  let staleRegistryNote: string | null = null;
  if (!registryAfterRule) {
    staleRegistryNote =
      `Warning: ${regPath} could not be re-read as a valid registry after the rule was granted ` +
      `(missing "tools" array — concurrent edit or corruption?); falling back to this promotion's ` +
      `in-memory state to clear "staged". Re-run approve if the registry looks wrong afterward.`;
    registryAfterRule = { ...registry, tools: toolsWithPin };
  }
  const idxAfterRule = registryAfterRule.tools.findIndex((t) => t && t.path === path);
  const finalTools = registryAfterRule.tools.slice();
  if (idxAfterRule !== -1) {
    const { staged: _staged, ...withoutStaged } = registryAfterRule.tools[idxAfterRule]!;
    finalTools[idxAfterRule] = withoutStaged;
  }
  atomicWrite(regPath, toJsonFile({ ...registryAfterRule, tools: finalTools }));

  try {
    if (existsSync(stagedAbs)) unlinkSync(stagedAbs);
  } catch (err) {
    process.stderr.write(`Warning: could not remove staged draft ${stagedAbs}: ${(err as Error).message}\n`);
  }

  process.stdout.write(
    [
      ...migrationNotes,
      ...(staleRegistryNote ? [staleRegistryNote] : []),
      ...lintNotes,
      `Promoted ${staged.path} -> ${scope.displayPath(path, liveAbs)}`,
      `Pinned: status=approved, approvedSha256=${placedSha}`,
      `permissionRule set to: ${rule}`,
      allowBefore.includes(rule)
        ? `Rule already present in ${settingsFile} (no-op).`
        : `Added rule to ${settingsFile} permissions.allow.`,
      `Live file mode: 0555${uchgResult.ok ? " + uchg" : ` (uchg unavailable: ${uchgResult.reason})`}.`,
      `Staging draft removed.`,
    ].join("\n") + "\n",
  );
  return 0;
}

/** Lenient JSON read used only for the dry-run "already granted?" display. */
function readRegistrylike(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}
