/**
 * Filesystem primitives shared by the toolsmith CLI's write paths: sha256
 * hashing, atomic placement, strict settings.json reading, and the BSD
 * immutable-flag helpers (write-denial layer 1,
 * docs/toolsmith/staged-live-split.md §Write denial).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { isPlainObject } from "./registry.js";

export function sha256OfBytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256OfFile(absPath: string): string {
  return sha256OfBytes(readFileSync(absPath));
}

/**
 * Atomically write `content` to `path`: write to a temp file in the same
 * directory, then rename over the target. Readers never observe a partial
 * write; a crash mid-write leaves the original file intact.
 */
export function atomicWrite(path: string, content: string | Buffer): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmpDir = mkdtempSync(join(dir, ".toolsmith-approve-"));
  const tmpFile = join(tmpDir, "tmp");
  try {
    if (Buffer.isBuffer(content)) writeFileSync(tmpFile, content);
    else writeFileSync(tmpFile, content, "utf8");
    renameSync(tmpFile, path);
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; the rename already moved the real file out
    }
  }
}

export function toJsonFile(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

export type SettingsRead =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Strictly resolve the settings.json object we're about to merge into, for
 * the write (non-dry-run) path only. Distinguishes "absent" (fine — start
 * from `{}`) from "present but unparseable / not a JSON object" (a
 * privileged, fail-closed writer must refuse to clobber a file it cannot
 * understand).
 */
export function readSettingsStrict(path: string): SettingsRead {
  if (!existsSync(path)) return { ok: true, value: {} };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, reason: `could not read ${path}: ${(err as Error).message}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: `${path} exists but is not valid JSON; refusing to overwrite it — fix the JSON and re-run.`,
    };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      reason: `${path} exists but its top level is not a JSON object; refusing to overwrite it — fix the JSON and re-run.`,
    };
  }
  // `permissions` and `permissions.allow`, if present at all, must already be
  // the shape we're about to merge into (object / array respectively) — a
  // present-but-wrong-shape value must never be silently coerced away.
  if ("permissions" in parsed && !isPlainObject(parsed["permissions"])) {
    return {
      ok: false,
      reason: `${path} has a "permissions" field that is not a JSON object; refusing to overwrite it — fix the JSON and re-run.`,
    };
  }
  const permissions = parsed["permissions"];
  if (isPlainObject(permissions) && "allow" in permissions && !Array.isArray(permissions["allow"])) {
    return {
      ok: false,
      reason: `${path} has a "permissions.allow" field that is not a JSON array; refusing to overwrite it — fix the JSON and re-run.`,
    };
  }
  return { ok: true, value: parsed };
}

// --- write-denial layer 1: mode + BSD immutable flag ------------------------
// `chflags` is BSD/macOS-only; elsewhere this degrades gracefully to
// mode-only protection and a warning — never a hard failure, since layers 2
// and 3 still hold without it.

let _chflagsAvailable: boolean | undefined;
export function chflagsAvailable(): boolean {
  if (_chflagsAvailable === undefined) {
    try {
      const r = spawnSync("which", ["chflags"], { stdio: "ignore" });
      _chflagsAvailable = r.status === 0;
    } catch {
      _chflagsAvailable = false;
    }
  }
  return _chflagsAvailable;
}

export type ChflagsResult = { ok: true } | { ok: false; reason: string };

/** Best-effort `chflags <flag> <absPath>`. Never throws. */
export function tryChflags(flag: "uchg" | "nouchg", absPath: string): ChflagsResult {
  if (!chflagsAvailable()) {
    return { ok: false, reason: "chflags is not available on this platform (non-macOS/BSD)" };
  }
  try {
    const r = spawnSync("chflags", [flag, absPath], { stdio: "pipe" });
    if (r.status !== 0) {
      const stderr = r.stderr ? r.stderr.toString().trim() : "";
      return { ok: false, reason: stderr || `chflags ${flag} exited with status ${r.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
