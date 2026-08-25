/**
 * Scope resolution for the toolsmith CLI: the project/user duality defined by
 * the shared-contract table in
 * plugins/toolsmith/skills/toolsmith/references/registry-schema.md.
 *
 * Ported from plugins/toolsmith/scripts/toolsmith-approve.mjs — behavior is
 * intentionally identical (same validation rules, same error strings' intent)
 * so the vitest port of test-approve.sh passes against the CLI unchanged.
 */
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

/** Conservative safe character set for a project-relative path. Anything
 * outside this set (whitespace, `(`, `)`, `:`, shell metacharacters, …) is
 * rejected outright: such characters would corrupt the generated
 * `Bash(<path>:*)` rule string or fail to round-trip as a registry match. */
const SAFE_PATH_CHARS = /^[A-Za-z0-9._/-]+$/;

/**
 * Validate a project-relative path: reject absolute paths, `..`/`.` traversal
 * segments, backslashes, and any character outside a conservative safe set.
 * Normalize a leading `./`. Returns the normalized path, or null if invalid.
 */
export function normalizePath(rawPath: unknown): string | null {
  if (typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  if (trimmed.includes("\\")) return null;
  if (trimmed.startsWith("/")) return null;
  // Windows-style absolute (e.g. C:\) is already caught by the backslash
  // check above; still guard drive-letter-colon forms defensively.
  if (/^[A-Za-z]:/.test(trimmed)) return null;
  const stripped = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
  if (!stripped || stripped.startsWith("/")) return null;
  if (!SAFE_PATH_CHARS.test(stripped)) return null;
  const segments = stripped.split("/");
  if (segments.some((seg) => seg === ".." || seg === "." || seg === "")) return null;
  return stripped;
}

/**
 * Accept either "<prefix>/<name>" or a bare "<name>" for a user-scope path,
 * normalize the bare form to "<prefix>/<name>", validate with the same strict
 * normalizePath() used for project paths, and additionally require the first
 * path segment to be exactly `prefix` — so the result can only ever resolve
 * under `<home>/.claude/toolsmith/<prefix>/`.
 */
export function normalizeUserScopedPath(rawPath: unknown, prefix: string): string | null {
  if (typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const candidate = trimmed.startsWith(`${prefix}/`) ? trimmed : `${prefix}/${trimmed}`;
  const normalized = normalizePath(candidate);
  if (!normalized) return null;
  const segments = normalized.split("/");
  if (segments[0] !== prefix || segments.length < 2 || !segments[1]) return null;
  return normalized;
}

export function normalizeUserPath(rawPath: unknown): string | null {
  return normalizeUserScopedPath(rawPath, "tools");
}

export function normalizeUserStagedPath(rawPath: unknown): string | null {
  return normalizeUserScopedPath(rawPath, "staging");
}

/**
 * A project-scope entry's `staged.path` must resolve strictly under
 * `.claude/toolsmith/staging/` (the mirrored sibling namespace, per
 * docs/toolsmith/staged-live-split.md §Registry schema changes) — unlike the
 * live `path` field, which may be anywhere in the project.
 */
export function normalizeStagedProjectPath(rawPath: unknown): string | null {
  const normalized = normalizePath(rawPath);
  if (!normalized) return null;
  const segments = normalized.split("/");
  if (segments.length < 4 || !segments[3]) return null;
  if (segments[0] !== ".claude" || segments[1] !== "toolsmith" || segments[2] !== "staging") return null;
  return normalized;
}

export function projectRoot(): string {
  return process.env["CLAUDE_PROJECT_DIR"] || process.env["CURSOR_PROJECT_DIR"] || process.cwd();
}

/**
 * Resolve the user's home directory defensively: `os.homedir()` can throw or
 * return an empty string in odd environments. The write side is fail-CLOSED,
 * so an unresolvable home directory is a hard error for `--user` invocations.
 */
export function resolveHome(): string | null {
  try {
    const home = homedir();
    return typeof home === "string" && home ? home : null;
  } catch {
    return null;
  }
}

/**
 * True if two paths name the same file on disk. Used to detect the
 * project-root-IS-home-directory conflation (issue #36). Prefers realpath so
 * a symlinked $HOME is still caught; if either path doesn't exist yet
 * (realpath throws), falls back to a plain resolved-path string comparison.
 */
export function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

export function registryPathFor(root: string): string {
  return join(root, ".claude", "toolsmith", "registry.json");
}

export function settingsPathFor(root: string): string {
  return join(root, ".claude", "settings.json");
}

export function userRegistryPath(home: string): string {
  return join(home, ".claude", "toolsmith", "registry.json");
}

export function userSettingsPath(home: string): string {
  return join(home, ".claude", "settings.json");
}

/** A scope descriptor shared by approve/verify/list so project and user
 * scope run through one implementation. */
export interface Scope {
  kind: "project" | "user";
  normalize: (rawPath: unknown) => string | null;
  normalizeStaged: (rawPath: unknown) => string | null;
  regPath: string;
  settingsFile: string;
  scriptAbs: (path: string) => string;
  stagedAbs: (stagedPath: string) => string;
  ruleFor: (path: string, scriptAbs: string) => string;
  displayPath: (path: string, scriptAbs: string) => string;
  invalidPathMessage: (rawPath: string) => string;
  invalidStagedPathMessage: (rawPath: string) => string;
}

export type ScopeResolution = { ok: true; scope: Scope } | { ok: false; error: string };

/**
 * Build the scope descriptor for project or user scope. Fail-closed on the
 * two hard cases: `--user` with an unresolvable home directory, and a
 * "project" registry that is actually the user registry because the session's
 * project root IS the home directory (issue #36).
 */
export function resolveScope(userScope: boolean): ScopeResolution {
  if (!userScope) {
    const root = projectRoot();
    const regPath = registryPathFor(root);
    const home = resolveHome();
    if (home && sameFile(regPath, userRegistryPath(home))) {
      return {
        ok: false,
        error:
          `Error: this session's project root is the home directory, so the "project" registry ` +
          `(${regPath}) is actually the user-scope registry. Re-run with --user so paths resolve ` +
          `against ~/.claude/toolsmith/ correctly.\n`,
      };
    }
    return {
      ok: true,
      scope: {
        kind: "project",
        normalize: normalizePath,
        normalizeStaged: normalizeStagedProjectPath,
        regPath,
        settingsFile: settingsPathFor(root),
        scriptAbs: (path) => join(root, path),
        stagedAbs: (stagedPath) => join(root, stagedPath),
        ruleFor: (path) => `Bash(${path}:*)`,
        displayPath: (path) => path,
        invalidPathMessage: (rawPath) =>
          `Error: invalid path "${rawPath}". Paths must be project-relative, contain no ".." ` +
          `segments, and use forward slashes only. Nothing written.\n`,
        invalidStagedPathMessage: (rawPath) =>
          `Error: invalid staged.path "${rawPath}" in the registry entry. It must be project-` +
          `relative, under ".claude/toolsmith/staging/", with no ".." segments. Nothing written.\n`,
      },
    };
  }
  const home = resolveHome();
  if (!home) {
    return { ok: false, error: `Error: could not resolve the home directory for --user. Nothing written.\n` };
  }
  return {
    ok: true,
    scope: {
      kind: "user",
      normalize: normalizeUserPath,
      normalizeStaged: normalizeUserStagedPath,
      regPath: userRegistryPath(home),
      settingsFile: userSettingsPath(home),
      scriptAbs: (path) => resolve(home, ".claude", "toolsmith", path),
      stagedAbs: (stagedPath) => resolve(home, ".claude", "toolsmith", stagedPath),
      ruleFor: (_path, scriptAbs) => `Bash(${scriptAbs}:*)`,
      displayPath: (_path, scriptAbs) => scriptAbs,
      invalidPathMessage: (rawPath) =>
        `Error: invalid tool "${rawPath}". Expected a bare tool name or "tools/<name>", with no ` +
        `".." segments, resolving under ~/.claude/toolsmith/tools/. Nothing written.\n`,
      invalidStagedPathMessage: (rawPath) =>
        `Error: invalid staged tool "${rawPath}" in the registry entry. Expected "staging/<name>", ` +
        `with no ".." segments, resolving under ~/.claude/toolsmith/staging/. Nothing written.\n`,
    },
  };
}
