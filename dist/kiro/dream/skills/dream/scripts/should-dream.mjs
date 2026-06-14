#!/usr/bin/env node
/**
 * Deterministic scheduling gate for the `dream` skill.
 *
 * Dreaming (memory consolidation) should run at most once per interval (default
 * 24h). This script owns the deterministic bookkeeping so the agent never has to
 * reason about elapsed time:
 *
 *   - `.dream-last`    — ISO timestamp of the last COMPLETED dream.
 *   - `.dream-pending` — presence = a dream is due/queued (contents: ISO of when queued).
 *
 * The session-end hook runs `tick` (drop the pending flag when due); the
 * session-start trigger (a rule, or an AGENTS.md polyfill on hook-less hosts)
 * runs `status` to decide whether to invoke `/dream`; the `/dream` skill runs
 * `record` on completion.
 *
 * Zero dependencies — node: builtins only. No Math.random(); the only clock read
 * is `new Date()` at CLI invocation time (injectable in the exported functions
 * for deterministic tests).
 *
 * State directory resolution (first match):
 *   1. $DREAM_HOME
 *   2. ~/.claude            (matches the native auto-dream convention)
 *
 * Interval override: $DREAM_INTERVAL_HOURS (default 24).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LAST_FILE = ".dream-last";
const PENDING_FILE = ".dream-pending";
const DEFAULT_INTERVAL_HOURS = 24;

/**
 * Resolve the directory holding dream state files.
 * @returns {string}
 */
export function resolveStateDir() {
  const override = process.env["DREAM_HOME"];
  if (override !== undefined && override !== "") return override;
  return join(homedir(), ".claude");
}

/**
 * The configured dream interval in hours ($DREAM_INTERVAL_HOURS or the default).
 * Invalid/zero/negative values fall back to the default.
 * @returns {number}
 */
export function resolveIntervalHours() {
  const raw = process.env["DREAM_INTERVAL_HOURS"];
  if (raw === undefined || raw === "") return DEFAULT_INTERVAL_HOURS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_HOURS;
}

/**
 * Read the timestamp of the last completed dream.
 * Returns null if absent or malformed (treated as "never dreamt" → due).
 * @param {string} stateDir
 * @returns {Date | null}
 */
export function getLastDreamTime(stateDir) {
  const file = join(stateDir, LAST_FILE);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8").trim();
    if (raw === "") return null;
    const t = new Date(raw);
    return Number.isNaN(t.getTime()) ? null : t;
  } catch {
    return null;
  }
}

/**
 * Whether a dream is due: never dreamt, or >= interval since the last one.
 * @param {string} stateDir
 * @param {{ now?: Date, intervalHours?: number }} [opts]
 * @returns {boolean}
 */
export function shouldDream(stateDir, opts = {}) {
  const now = opts.now ?? new Date();
  const intervalHours = opts.intervalHours ?? resolveIntervalHours();
  const last = getLastDreamTime(stateDir);
  if (last === null) return true;
  const elapsedMs = now.getTime() - last.getTime();
  return elapsedMs >= intervalHours * 60 * 60 * 1000;
}

/**
 * Whether a dream is currently queued (the pending flag exists).
 * @param {string} stateDir
 * @returns {boolean}
 */
export function isPending(stateDir) {
  return existsSync(join(stateDir, PENDING_FILE));
}

/**
 * Drop the pending flag (idempotent). Creates the state dir if needed.
 * @param {string} stateDir
 * @param {{ now?: Date }} [opts]
 * @returns {string} the flag file path
 */
export function dropPendingFlag(stateDir, opts = {}) {
  const now = opts.now ?? new Date();
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, PENDING_FILE);
  writeFileSync(file, now.toISOString() + "\n", "utf8");
  return file;
}

/**
 * Remove the pending flag if present (idempotent).
 * @param {string} stateDir
 */
export function clearPendingFlag(stateDir) {
  rmSync(join(stateDir, PENDING_FILE), { force: true });
}

/**
 * Record a completed dream: stamp `.dream-last` = now and clear the pending flag.
 * @param {string} stateDir
 * @param {{ now?: Date }} [opts]
 * @returns {string} the ISO timestamp written
 */
export function recordDream(stateDir, opts = {}) {
  const now = opts.now ?? new Date();
  mkdirSync(stateDir, { recursive: true });
  const iso = now.toISOString();
  writeFileSync(join(stateDir, LAST_FILE), iso + "\n", "utf8");
  clearPendingFlag(stateDir);
  return iso;
}

/**
 * A machine-readable status snapshot.
 * @param {string} stateDir
 * @param {{ now?: Date, intervalHours?: number }} [opts]
 * @returns {{ due: boolean, pending: boolean, lastDream: string | null, intervalHours: number }}
 */
export function readStatus(stateDir, opts = {}) {
  const intervalHours = opts.intervalHours ?? resolveIntervalHours();
  const last = getLastDreamTime(stateDir);
  return {
    due: shouldDream(stateDir, { now: opts.now, intervalHours }),
    pending: isPending(stateDir),
    lastDream: last === null ? null : last.toISOString(),
    intervalHours,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * @param {string[]} argv  process.argv.slice(2)
 * @param {(s: string) => void} [out]
 * @returns {number} exit code
 */
export function runCli(argv, out = (s) => process.stdout.write(s)) {
  const [command, ...rest] = argv;
  const stateDir = resolveStateDir();

  switch (command) {
    case "tick": {
      // Session-end hook: queue a dream when one is due. Never blocks.
      if (shouldDream(stateDir)) {
        dropPendingFlag(stateDir);
        out("dream: queued (due)\n");
      }
      return 0;
    }
    case "status": {
      const status = readStatus(stateDir);
      if (rest.includes("--json")) {
        out(JSON.stringify(status) + "\n");
      } else {
        out(
          `due=${status.due} pending=${status.pending} ` +
            `lastDream=${status.lastDream ?? "never"} intervalHours=${status.intervalHours}\n`,
        );
      }
      return 0;
    }
    case "record": {
      const iso = recordDream(stateDir);
      out(`dream: recorded at ${iso}\n`);
      return 0;
    }
    case "clear": {
      clearPendingFlag(stateDir);
      out("dream: pending flag cleared\n");
      return 0;
    }
    default: {
      process.stderr.write(
        "Usage: node should-dream.mjs <tick|status [--json]|record|clear>\n\n" +
          "  tick     queue a dream if the interval has elapsed (session-end hook)\n" +
          "  status   print {due,pending,lastDream,intervalHours} (session-start trigger)\n" +
          "  record   stamp a completed dream and clear the pending flag (run by /dream)\n" +
          "  clear    remove the pending flag without recording a dream\n\n" +
          "Env: DREAM_HOME (state dir, default ~/.claude), DREAM_INTERVAL_HOURS (default 24)\n",
      );
      return 2;
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(runCli(process.argv.slice(2)));
}
