/**
 * Effective-watchlist computation, ported from toolsmith-check.mjs so the
 * analyze verb classifies commands with exactly the semantics the PreToolUse
 * hook enforces: shipped defaults, then the user config, then the project
 * config, applied broad→specific (registry-schema.md §config.json).
 */
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJsonOrNull, isPlainObject } from "./registry.js";

interface WatchlistConfigLayer {
  watchlist?: {
    add?: unknown;
    remove?: unknown;
  };
}

/**
 * Locate the shipped watchlist defaults. The CLI bundle lives at
 * `<plugin>/scripts/toolsmith`, so the defaults sit at
 * `../skills/toolsmith/references/watchlist-defaults.json` relative to the
 * executable; CLAUDE_PLUGIN_ROOT (set by the host when commands run) wins
 * when present.
 */
export function defaultWatchlistPath(): string | null {
  const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
  const rel = ["skills", "toolsmith", "references", "watchlist-defaults.json"];
  if (pluginRoot) return join(pluginRoot, ...rel);
  const argv1 = process.argv[1];
  if (!argv1) return null;
  try {
    return join(dirname(realpathSync(argv1)), "..", ...rel);
  } catch {
    return join(dirname(argv1), "..", ...rel);
  }
}

/** Apply one config layer's `remove` (verbatim match) then union in `add`. */
function applyWatchlistLayer(patterns: string[], config: unknown): string[] {
  const layer = isPlainObject(config) ? (config as WatchlistConfigLayer) : {};
  const remove = new Set(
    Array.isArray(layer.watchlist?.remove) ? layer.watchlist.remove.filter((p): p is string => typeof p === "string") : [],
  );
  const add = Array.isArray(layer.watchlist?.add)
    ? layer.watchlist.add.filter((p): p is string => typeof p === "string")
    : [];
  return [...new Set([...patterns.filter((p) => !remove.has(p)), ...add])];
}

/** The effective watchlist pattern strings, defaults ± user ± project config. */
export function effectiveWatchlistPatterns(userConfigPath: string | null, projectConfigPath: string): string[] {
  const defaultsPath = defaultWatchlistPath();
  const defaults = defaultsPath ? readJsonOrNull(defaultsPath) : null;
  const watchlist = isPlainObject(defaults) ? defaults["watchlist"] : null;
  const defaultPatterns = Array.isArray(watchlist)
    ? watchlist
        .map((e: unknown) => (isPlainObject(e) ? e["pattern"] : null))
        .filter((p): p is string => typeof p === "string")
    : [];
  let patterns = defaultPatterns;
  const userConfig = userConfigPath ? readJsonOrNull(userConfigPath) : null;
  const projectConfig = readJsonOrNull(projectConfigPath);
  for (const config of [userConfig, projectConfig]) {
    patterns = applyWatchlistLayer(patterns, config);
  }
  return patterns;
}

export function toRegExp(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export function safeTest(re: RegExp | null, s: string): boolean {
  if (!re) return false;
  try {
    return re.test(s);
  } catch {
    return false;
  }
}
