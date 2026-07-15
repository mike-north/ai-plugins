#!/usr/bin/env node
/**
 * toolsmith-approve: the deterministic write/approve side of the toolsmith
 * proofread-then-allowlist handshake.
 *
 * toolsmith-check.mjs (the PreToolUse hook) deterministically reads the
 * registry and hash-pins on the way in. This tool is its write-side
 * counterpart: it deterministically pins a registry entry's approved hash and
 * grants exactly one bounded `Bash(<path>:*)` permission rule, so the agent
 * never freehands the write. It is bounded and FAIL-CLOSED: any validation
 * failure exits non-zero and writes nothing (never a half-write), unlike the
 * fail-open hook, whose safety property is "never brick the shell".
 *
 * Usage:
 *   toolsmith-approve <path>                     approve (default) — pin the hash + grant the rule
 *   toolsmith-approve <path> --dry-run           preview — no writes
 *   toolsmith-approve <name> --user [--dry-run]  same, for a user-scope tool
 *   toolsmith-approve --verify [--user] [<path>] read-only integrity check
 *   toolsmith-approve --help                     usage
 *
 * @see https://code.claude.com/docs/en/hooks.md
 */
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const HELP = `toolsmith-approve — proofread-then-allowlist handshake (write side)

Usage:
  toolsmith-approve <path>                     Approve: pin the registry hash + grant the rule
  toolsmith-approve <path> --dry-run           Preview the pin + grant — no writes
  toolsmith-approve <name-or-path> --user [--dry-run]
                                                Same, but for a user-scope (global) tool
  toolsmith-approve --verify [--user] [<path>] Read-only integrity check (all tools, or one)
  toolsmith-approve --help                     Show this help

<path> must be a project-relative path to a script already registered as a
draft entry in .claude/toolsmith/registry.json (name/purpose/args/scope/covers
authored by hand — this tool only pins the hash and grants the permission).

With --user, <path> is instead a bare tool name or a "tools/<name>" path,
resolved against the user-scope registry at ~/.claude/toolsmith/registry.json
and its scripts under ~/.claude/toolsmith/tools/. The granted rule uses the
fully-expanded absolute script path.
`;

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const userScope = args.includes('--user');
  const rest = args.filter((a) => a !== '--user');

  if (rest[0] === '--verify') {
    process.exit(runVerify(rest[1], userScope));
  }

  const dryRun = rest.includes('--dry-run');
  const pathArgs = rest.filter((a) => a !== '--dry-run');
  if (pathArgs.length !== 1 || !pathArgs[0]) {
    process.stderr.write('Error: expected exactly one <path> argument.\n\n' + HELP);
    process.exit(1);
  }

  process.exit(runApprove(pathArgs[0], !dryRun, userScope));
}

// --- shared helpers --------------------------------------------------------

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.CURSOR_PROJECT_DIR || process.cwd();
}

function registryPath(root) {
  return join(root, '.claude', 'toolsmith', 'registry.json');
}

function settingsPath(root) {
  return join(root, '.claude', 'settings.json');
}

/**
 * Resolve the user's home directory defensively: `os.homedir()` can throw or
 * return an empty string in odd environments. This tool is fail-CLOSED, so an
 * unresolvable home directory is treated as a hard error for `--user`
 * invocations rather than silently falling back to something else.
 */
function resolveHome() {
  try {
    const home = homedir();
    return typeof home === 'string' && home ? home : null;
  } catch {
    return null;
  }
}

function userRegistryPath(home) {
  return join(home, '.claude', 'toolsmith', 'registry.json');
}

function userSettingsPath(home) {
  return join(home, '.claude', 'settings.json');
}

/**
 * Accept either "tools/<name>" or a bare "<name>" for a user-scope tool,
 * normalize the bare form to "tools/<name>", validate with the same strict
 * normalizePath() used for project paths, and additionally require the first
 * path segment to be exactly "tools" — so the result can only ever resolve
 * under `<home>/.claude/toolsmith/tools/`. Anything that would escape that
 * directory (absolute, "..", wrong first segment) is rejected.
 */
function normalizeUserPath(rawPath) {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const candidate = trimmed.startsWith('tools/') ? trimmed : `tools/${trimmed}`;
  const normalized = normalizePath(candidate);
  if (!normalized) return null;
  const segments = normalized.split('/');
  if (segments[0] !== 'tools' || segments.length < 2 || !segments[1]) return null;
  return normalized;
}

/**
 * Build a small scope descriptor so runApprove/runVerify can share one
 * implementation across project and user scope. Returns null if `--user` was
 * requested but the home directory could not be resolved (resolveHome()).
 */
function resolveScope(userScope) {
  if (!userScope) {
    const root = projectRoot();
    return {
      kind: 'project',
      normalize: normalizePath,
      regPath: registryPath(root),
      settingsFile: settingsPath(root),
      scriptAbs: (path) => join(root, path),
      ruleFor: (path) => `Bash(${path}:*)`,
      displayPath: (path) => path,
      invalidPathMessage: (rawPath) =>
        `Error: invalid path "${rawPath}". Paths must be project-relative, contain no ".." ` +
        `segments, and use forward slashes only. Nothing written.\n`,
    };
  }
  const home = resolveHome();
  if (!home) return null;
  return {
    kind: 'user',
    normalize: normalizeUserPath,
    regPath: userRegistryPath(home),
    settingsFile: userSettingsPath(home),
    scriptAbs: (path) => resolve(home, '.claude', 'toolsmith', path),
    ruleFor: (_path, scriptAbs) => `Bash(${scriptAbs}:*)`,
    displayPath: (_path, scriptAbs) => scriptAbs,
    invalidPathMessage: (rawPath) =>
      `Error: invalid tool "${rawPath}". Expected a bare tool name or "tools/<name>", with no ` +
      `".." segments, resolving under ~/.claude/toolsmith/tools/. Nothing written.\n`,
  };
}

// Conservative safe character set for a project-relative path. Anything
// outside this set (whitespace, `(`, `)`, `:`, shell metacharacters, …) is
// rejected outright: such characters would corrupt the generated
// `Bash(<path>:*)` rule string (e.g. a stray `)` or `:` changes or breaks the
// rule) or otherwise fail to round-trip as the intended registry match.
const SAFE_PATH_CHARS = /^[A-Za-z0-9._/-]+$/;

/**
 * Validate a project-relative path: reject absolute paths, `..`/`.` traversal
 * segments, backslashes, and any character outside a conservative safe set.
 * Normalize a leading `./`. Returns the normalized path, or null if invalid.
 */
function normalizePath(rawPath) {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  if (trimmed.includes('\\')) return null;
  if (trimmed.startsWith('/')) return null;
  // Windows-style absolute (e.g. C:\) is already caught by the backslash
  // check above; still guard drive-letter-colon forms defensively.
  if (/^[A-Za-z]:/.test(trimmed)) return null;
  const stripped = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
  if (!stripped || stripped.startsWith('/')) return null;
  if (!SAFE_PATH_CHARS.test(stripped)) return null;
  const segments = stripped.split('/');
  if (segments.some((seg) => seg === '..' || seg === '.' || seg === '')) return null;
  return stripped;
}

function readJsonOrNull(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strictly resolve the settings.json object we're about to merge into, for
 * the write (non-dry-run) path only. Distinguishes "absent" (fine — start from `{}`)
 * from "present but unparseable / not a JSON object" (a privileged,
 * fail-closed writer must refuse to clobber a file it cannot understand).
 * Returns `{ ok: true, value }` or `{ ok: false, reason }`.
 */
function readSettingsStrict(path) {
  if (!existsSync(path)) return { ok: true, value: {} };
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, reason: `could not read ${path}: ${err.message}` };
  }
  let parsed;
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
  // the shape we're about to merge into (object / array respectively). A
  // present-but-wrong-shape value could otherwise be silently coerced away
  // (e.g. a string `allow` replaced with a fresh `[]`), which is exactly the
  // kind of clobber a fail-closed writer must refuse instead of guessing.
  if ('permissions' in parsed && !isPlainObject(parsed.permissions)) {
    return {
      ok: false,
      reason: `${path} has a "permissions" field that is not a JSON object; refusing to overwrite it — fix the JSON and re-run.`,
    };
  }
  if (isPlainObject(parsed.permissions) && 'allow' in parsed.permissions && !Array.isArray(parsed.permissions.allow)) {
    return {
      ok: false,
      reason: `${path} has a "permissions.allow" field that is not a JSON array; refusing to overwrite it — fix the JSON and re-run.`,
    };
  }
  return { ok: true, value: parsed };
}

function sha256OfFile(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

/**
 * Atomically write `content` to `path`: write to a temp file in the same
 * directory, then rename over the target. Ensures readers never observe a
 * partial write, and a crash mid-write leaves the original file intact.
 */
function atomicWrite(path, content) {
  const dir = dirname(path);
  const tmpDir = mkdtempSync(join(dir, '.toolsmith-approve-'));
  const tmpFile = join(tmpDir, 'tmp');
  try {
    writeFileSync(tmpFile, content, 'utf8');
    renameSync(tmpFile, path);
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; the rename already moved the real file out
    }
  }
}

function toJsonFile(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

// --- approve flow ------------------------------------------------------

function runApprove(rawPath, commit, userScope) {
  const scope = resolveScope(userScope);
  if (!scope) {
    process.stderr.write(`Error: could not resolve the home directory for --user. Nothing written.\n`);
    return 1;
  }

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

  const registry = readJsonOrNull(regPath);
  if (!registry || !Array.isArray(registry.tools)) {
    process.stderr.write(`Error: ${regPath} is not a valid registry (malformed JSON or missing "tools" array). Nothing written.\n`);
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
  const entry = registry.tools[idx];

  const absScript = scope.scriptAbs(path);
  if (!existsSync(absScript)) {
    process.stderr.write(`Error: script file not found at ${absScript}. Nothing written.\n`);
    return 1;
  }

  let sha;
  try {
    sha = sha256OfFile(absScript);
  } catch (err) {
    process.stderr.write(`Error: could not read ${absScript}: ${err.message}. Nothing written.\n`);
    return 1;
  }

  const rule = scope.ruleFor(path, absScript);
  const settingsFile = scope.settingsFile;
  const existingSettings = existsSync(settingsFile) ? readJsonOrNull(settingsFile) : {};
  const alreadyGranted =
    existingSettings &&
    Array.isArray(existingSettings.permissions?.allow) &&
    existingSettings.permissions.allow.includes(rule);

  if (!commit) {
    process.stdout.write(
      [
        `Tool: ${entry.name ?? '(unnamed)'}`,
        `Path: ${scope.displayPath(path, absScript)}`,
        `Computed sha256: ${sha}`,
        `Permission rule: ${rule}`,
        `Already in settings.json: ${alreadyGranted ? 'yes' : 'no'}`,
        '',
        'DRY RUN — nothing written; re-run without --dry-run to apply.',
      ].join('\n') + '\n',
    );
    return 0;
  }

  // --- commit: pin registry, chmod +x, grant permission rule ---
  // Validate settings.json BEFORE any write, so a malformed/non-object
  // settings.json aborts the *entire* commit (registry pin included) rather
  // than pinning the registry and then clobbering settings.json. This keeps
  // the commit fail-closed: either both writes happen, or neither does.
  const settingsCheck = readSettingsStrict(settingsFile);
  if (!settingsCheck.ok) {
    process.stderr.write(`Error: ${settingsCheck.reason} Nothing written.\n`);
    return 1;
  }

  const updatedEntry = {
    ...entry,
    status: 'approved',
    approvedSha256: sha,
    permissionRule: rule,
  };
  const updatedTools = registry.tools.slice();
  updatedTools[idx] = updatedEntry;
  const updatedRegistry = { ...registry, tools: updatedTools };

  atomicWrite(regPath, toJsonFile(updatedRegistry));

  try {
    chmodSync(absScript, 0o755);
  } catch (err) {
    process.stderr.write(`Warning: could not chmod +x ${absScript}: ${err.message}\n`);
  }

  const settingsBefore = settingsCheck.value;
  const permissionsBefore =
    settingsBefore.permissions && typeof settingsBefore.permissions === 'object' ? settingsBefore.permissions : {};
  const allowBefore = Array.isArray(permissionsBefore.allow) ? permissionsBefore.allow : [];
  const allowAfter = allowBefore.includes(rule) ? allowBefore : [...allowBefore, rule];

  const updatedSettings = {
    ...settingsBefore,
    permissions: {
      ...permissionsBefore,
      allow: allowAfter,
    },
  };
  atomicWrite(settingsFile, toJsonFile(updatedSettings));

  process.stdout.write(
    [
      `Pinned ${path}: status=approved, approvedSha256=${sha}`,
      `permissionRule set to: ${rule}`,
      allowBefore.includes(rule)
        ? `Rule already present in ${settingsFile} (no-op).`
        : `Added rule to ${settingsFile} permissions.allow.`,
      `chmod +x applied to ${absScript}.`,
    ].join('\n') + '\n',
  );
  return 0;
}

// --- verify flow ------------------------------------------------------

function runVerify(rawPath, userScope) {
  const scope = resolveScope(userScope);
  if (!scope) {
    process.stderr.write(`Error: could not resolve the home directory for --user.\n`);
    return 1;
  }

  const regPath = scope.regPath;
  if (!existsSync(regPath)) {
    process.stderr.write(`Error: no registry found at ${regPath}.\n`);
    return 1;
  }
  const registry = readJsonOrNull(regPath);
  if (!registry || !Array.isArray(registry.tools)) {
    process.stderr.write(`Error: ${regPath} is not a valid registry (malformed JSON or missing "tools" array).\n`);
    return 1;
  }

  let filterPath = null;
  if (rawPath) {
    filterPath = scope.normalize(rawPath);
    if (!filterPath) {
      process.stderr.write(`Error: invalid path "${rawPath}".\n`);
      return 1;
    }
  }

  const tools = filterPath ? registry.tools.filter((t) => t && t.path === filterPath) : registry.tools;
  if (filterPath && tools.length === 0) {
    process.stderr.write(`Error: no registry entry found with path "${filterPath}".\n`);
    return 1;
  }

  let anyBad = false;
  for (const tool of tools) {
    const name = tool?.name ?? '(unnamed)';
    const rawToolPath = tool?.path ?? '(no path)';
    if (tool?.status !== 'approved') {
      process.stdout.write(`draft    ${name}\t${rawToolPath}\n`);
      continue;
    }
    // A registry entry's `path` is untrusted input (the registry could be
    // tampered, or hand-edited incorrectly): re-validate it with the same
    // strict path validation used on the write side before ever resolving it
    // to a script file. Skipping this check would let a tampered entry make
    // --verify read/hash a file outside the intended scope root. An invalid
    // path is never touched on disk — it is reported as MISSING and fails
    // the run.
    const path = scope.normalize(rawToolPath);
    if (!path) {
      process.stdout.write(`MISSING  ${name}\t${rawToolPath}\n`);
      anyBad = true;
      continue;
    }
    const abs = scope.scriptAbs(path);
    if (!existsSync(abs)) {
      process.stdout.write(`MISSING  ${name}\t${path}\n`);
      anyBad = true;
      continue;
    }
    let sha;
    try {
      sha = sha256OfFile(abs);
    } catch {
      process.stdout.write(`MISSING  ${name}\t${path}\n`);
      anyBad = true;
      continue;
    }
    if (sha === tool.approvedSha256) {
      process.stdout.write(`OK       ${name}\t${path}\n`);
    } else {
      process.stdout.write(`DRIFTED  ${name}\t${path}\n`);
      anyBad = true;
    }
  }

  return anyBad ? 1 : 0;
}

main();
