#!/usr/bin/env node
/**
 * Deterministic preflight for the product-led-eng-fleet ORCHESTRATOR kickoff.
 *
 * The orchestrator (PM or eng-TL) must run in a dedicated, role-scoped worktree —
 * not the primary checkout, and not with the wrong role's plugins enabled. This
 * script is the deterministic gate the kickoff runs FIRST; it exits non-zero with a
 * clear message if the environment is wrong, and the orchestrator stops.
 *
 * It asserts three things:
 *   1. cwd is a LINKED git worktree, not the primary checkout (so the orchestrator
 *      never runs in your main tree; it also won't cascade to implementer sub-agents,
 *      which spawn their own worktrees).
 *   2. A role marker `.claude/fleet-role.json` is present and well-formed.
 *   3. The marker's `require` plugins are enabled and its `forbid` plugins are not,
 *      per the merged enabledPlugins (user -> project -> local settings precedence).
 *
 * Marker contract (`.claude/fleet-role.json` in the orchestrator worktree):
 *   { "role": "eng", "require": ["product-led-eng-fleet", "github-fleet-tools"], "forbid": [] }
 * Plugin names are matched BARE (the part before `@marketplace`).
 *
 * No LLM reasoning, no dependencies — pure `node:` builtins, so it is fully testable.
 * The pure functions below take injected inputs; the CLI at the bottom gathers the
 * real git/fs state and calls them.
 *
 * CLI usage (from the kickoff):
 *   node orchestrator-preflight.mjs            # validates ${PWD}; exit 0 = ok, 1 = stop
 *   node orchestrator-preflight.mjs --json     # machine-readable verdict on stdout
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import process from "node:process";

// ---------------------------------------------------------------------------
// Pure logic (injected inputs — unit-tested directly)
// ---------------------------------------------------------------------------

/** @param {unknown} v */
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * A plugin's enabledPlugins value is "enabled" when it is `true` or a non-empty
 * version-constraint array. `false`, `undefined`, `null`, and `[]` are disabled.
 * @param {unknown} v
 */
export function isEnabledValue(v) {
  if (v === true) return true;
  if (Array.isArray(v)) return v.length > 0;
  return false;
}

/**
 * Parse and validate a `.claude/fleet-role.json` marker.
 * @param {string} text raw file contents
 * @returns {{ role: string, require: string[], forbid: string[] }}
 * @throws {Error} with a human-actionable message on any malformation
 */
export function parseMarker(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error(`.claude/fleet-role.json is not valid JSON: ${(e && e.message) || e}`);
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error(".claude/fleet-role.json must be a JSON object");
  }
  if (typeof obj.role !== "string" || obj.role.trim() === "") {
    throw new Error('.claude/fleet-role.json: "role" must be a non-empty string');
  }
  const require_ = obj.require ?? [];
  const forbid = obj.forbid ?? [];
  if (!isStringArray(require_)) {
    throw new Error('.claude/fleet-role.json: "require" must be an array of plugin-name strings');
  }
  if (!isStringArray(forbid)) {
    throw new Error('.claude/fleet-role.json: "forbid" must be an array of plugin-name strings');
  }
  return { role: obj.role.trim(), require: require_, forbid };
}

/**
 * Compute the set of BARE plugin names that are effectively enabled, applying
 * settings precedence (lowest first; later sources override earlier per full
 * `name@marketplace` key). A bare name is enabled if ANY of its `@marketplace`
 * keys ends up truthy.
 * @param {Array<Record<string, unknown>>} settingsLowestFirst
 * @returns {Set<string>}
 */
export function computeEnabledPlugins(settingsLowestFirst) {
  /** @type {Map<string, unknown>} */
  const effective = new Map();
  for (const s of settingsLowestFirst) {
    const ep = s && /** @type {any} */ (s).enabledPlugins;
    if (ep && typeof ep === "object" && !Array.isArray(ep)) {
      for (const [k, v] of Object.entries(ep)) effective.set(k, v);
    }
  }
  /** @type {Set<string>} */
  const enabled = new Set();
  for (const [k, v] of effective) {
    if (isEnabledValue(v)) enabled.add(k.split("@")[0]);
  }
  return enabled;
}

/**
 * Worktree check. Returns a violation string, or null if cwd is a linked worktree.
 * @param {string|null} gitDir absolute path to this worktree's git dir
 * @param {string|null} commonDir absolute path to the shared (primary) git dir
 */
export function checkLinkedWorktree(gitDir, commonDir) {
  if (!gitDir || !commonDir) {
    return "not inside a git repository (could not resolve the git directory)";
  }
  if (gitDir === commonDir) {
    return "running in the PRIMARY checkout, not a dedicated worktree — run the orchestrator from a role-scoped linked worktree";
  }
  return null;
}

/**
 * Aggregate all preflight violations (does not short-circuit, so the operator sees
 * every problem at once).
 * @param {{ gitDir: string|null, commonDir: string|null,
 *           marker: { role: string, require: string[], forbid: string[] },
 *           enabledNames: Set<string> }} input
 * @returns {{ ok: boolean, role: string, violations: string[] }}
 */
export function runPreflight({ gitDir, commonDir, marker, enabledNames }) {
  const violations = [];
  const wt = checkLinkedWorktree(gitDir, commonDir);
  if (wt) violations.push(wt);
  for (const name of marker.require) {
    if (!enabledNames.has(name)) violations.push(`required plugin not enabled: ${name}`);
  }
  for (const name of marker.forbid) {
    if (enabledNames.has(name)) violations.push(`forbidden plugin is enabled (wrong role for this worktree): ${name}`);
  }
  return { ok: violations.length === 0, role: marker.role, violations };
}

// ---------------------------------------------------------------------------
// I/O boundary (gather real state) + CLI
// ---------------------------------------------------------------------------

/** @param {string} p */
function readJsonIfExists(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/** @param {string} cwd */
function gatherGitDirs(cwd) {
  const git = (args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const gitDir = fs.realpathSync(path.resolve(cwd, git(["rev-parse", "--absolute-git-dir"])));
    const commonRaw = git(["rev-parse", "--git-common-dir"]);
    const commonDir = fs.realpathSync(path.resolve(cwd, commonRaw));
    return { gitDir, commonDir };
  } catch {
    return { gitDir: null, commonDir: null };
  }
}

function main() {
  const cwd = process.cwd();
  const asJson = process.argv.includes("--json");
  const markerPath = path.join(cwd, ".claude", "fleet-role.json");

  let marker;
  try {
    marker = parseMarker(fs.readFileSync(markerPath, "utf8"));
  } catch (e) {
    const isMissing = e && e.code === "ENOENT";
    const msg = isMissing
      ? `no .claude/fleet-role.json in ${cwd} — this worktree is not marked as a fleet orchestrator worktree.\n` +
        `Create one, e.g.:\n` +
        `  { "role": "eng", "require": ["product-led-eng-fleet", "github-fleet-tools"], "forbid": [] }`
      : `invalid .claude/fleet-role.json: ${(e && e.message) || e}`;
    emit({ ok: false, role: null, violations: [msg] }, asJson);
    process.exit(1);
  }

  const { gitDir, commonDir } = gatherGitDirs(cwd);
  const enabledNames = computeEnabledPlugins([
    readJsonIfExists(path.join(os.homedir(), ".claude", "settings.json")),
    readJsonIfExists(path.join(cwd, ".claude", "settings.json")),
    readJsonIfExists(path.join(cwd, ".claude", "settings.local.json")),
  ]);

  const verdict = runPreflight({ gitDir, commonDir, marker, enabledNames });
  emit(verdict, asJson);
  process.exit(verdict.ok ? 0 : 1);
}

/** @param {{ ok: boolean, role: string|null, violations: string[] }} verdict */
function emit(verdict, asJson) {
  if (asJson) {
    process.stdout.write(JSON.stringify(verdict) + "\n");
    return;
  }
  if (verdict.ok) {
    process.stdout.write(`✓ orchestrator preflight OK — role=${verdict.role}\n`);
    return;
  }
  process.stderr.write("✗ orchestrator preflight FAILED — do not start the loop:\n");
  for (const v of verdict.violations) process.stderr.write(`  - ${v}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
