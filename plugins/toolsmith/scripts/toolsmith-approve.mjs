#!/usr/bin/env node
/**
 * toolsmith-approve: the deterministic promotion/write side of the toolsmith
 * staged/live split (docs/toolsmith/staged-live-split.md).
 *
 * toolsmith-check.mjs (the PreToolUse hook) deterministically reads the
 * registry and hash-pins on the way in, and never looks at staging at all.
 * This tool is the write-side counterpart: it promotes an agent-authored
 * staging draft into the tool's live path as a deterministic apply manifest
 * (nouchg -> atomic place -> chmod 0555 + uchg -> recompute+pin -> grant rule
 * -> clear staged -> remove the staging file), so the agent never freehands
 * the write, the hash, or the permission grant. It is bounded and
 * FAIL-CLOSED: any validation failure before the apply begins exits non-zero
 * and writes nothing; a failure mid-apply leaves live refused-closed (its pin
 * won't match) until a re-run, and the apply is idempotent so a re-run
 * converges rather than double-applying.
 *
 * Usage:
 *   toolsmith-approve <path>                     promote (default) — place the staged draft as live
 *   toolsmith-approve <path> --dry-run           preview — no writes
 *   toolsmith-approve <name> --user [--dry-run]  same, for a user-scope tool
 *   toolsmith-approve --verify [--user] [<path>] read-only integrity check (live pins only)
 *   toolsmith-approve --help                     usage
 *
 * @see docs/toolsmith/staged-live-split.md
 * @see https://code.claude.com/docs/en/hooks.md
 */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
  statSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const HELP = `toolsmith-approve — the staged/live promotion handshake (write side)

Usage:
  toolsmith-approve <path>                     Promote: place the staged draft as live, pin + grant
  toolsmith-approve <path> --dry-run           Preview the promotion — no writes
  toolsmith-approve <name-or-path> --user [--dry-run]
                                                Same, but for a user-scope (global) tool
  toolsmith-approve --verify [--user] [<path>] Read-only integrity check of LIVE pins (all tools, or one)
  toolsmith-approve --help                     Show this help

<path> must be a project-relative path naming a registry entry in
.claude/toolsmith/registry.json (name/purpose/args/scope/covers authored by
hand). The entry must carry a "staged" field pointing at a draft under
.claude/toolsmith/staging/<name> — this tool promotes exactly those bytes to
<path>; it never invents or accepts freehand script content.

With --user, <path> is instead a bare tool name or a "tools/<name>" path,
resolved against the user-scope registry at ~/.claude/toolsmith/registry.json,
its live scripts under ~/.claude/toolsmith/tools/, and its staging drafts
under ~/.claude/toolsmith/staging/. The granted rule uses the fully-expanded
absolute script path.
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

/**
 * True if two paths name the same file on disk. Used to detect the
 * project-root-IS-home-directory conflation (issue #36, see resolveScope()).
 * Prefers realpath so a symlinked $HOME is still caught; if either path
 * doesn't exist yet (realpath throws — e.g. neither registry has been
 * created), falls back to a plain resolved-path string comparison.
 */
function sameFile(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

function userSettingsPath(home) {
  return join(home, '.claude', 'settings.json');
}

/**
 * Accept either "<prefix>/<name>" or a bare "<name>" for a user-scope path,
 * normalize the bare form to "<prefix>/<name>", validate with the same strict
 * normalizePath() used for project paths, and additionally require the first
 * path segment to be exactly `prefix` — so the result can only ever resolve
 * under `<home>/.claude/toolsmith/<prefix>/`. Anything that would escape that
 * directory (absolute, "..", wrong first segment) is rejected. Shared by the
 * live-tool path ("tools") and the staged-draft path ("staging") conventions.
 */
function normalizeUserScopedPath(rawPath, prefix) {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const candidate = trimmed.startsWith(`${prefix}/`) ? trimmed : `${prefix}/${trimmed}`;
  const normalized = normalizePath(candidate);
  if (!normalized) return null;
  const segments = normalized.split('/');
  if (segments[0] !== prefix || segments.length < 2 || !segments[1]) return null;
  return normalized;
}

function normalizeUserPath(rawPath) {
  return normalizeUserScopedPath(rawPath, 'tools');
}

function normalizeUserStagedPath(rawPath) {
  return normalizeUserScopedPath(rawPath, 'staging');
}

/**
 * A project-scope entry's `staged.path` must resolve strictly under
 * `.claude/toolsmith/staging/` (the mirrored sibling namespace, per
 * docs/toolsmith/staged-live-split.md §Registry schema changes) — unlike the
 * live `path` field, which may be anywhere in the project. Reject anything
 * outside that prefix rather than resolving it as-is.
 */
function normalizeStagedProjectPath(rawPath) {
  const normalized = normalizePath(rawPath);
  if (!normalized) return null;
  const segments = normalized.split('/');
  if (segments.length < 4 || !segments[3]) return null;
  if (segments[0] !== '.claude' || segments[1] !== 'toolsmith' || segments[2] !== 'staging') return null;
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
    const regPath = registryPath(root);
    // The project registry and the user registry are the exact same file
    // when this session's project root IS the home directory (root ===
    // home) — a session rooted at `~`, or at a path resolving to it via symlink.
    // Unlike toolsmith-check.mjs (fail-open, silently treats it as user
    // scope), this write path is fail-closed: refuse with a clear pointer to
    // --user rather than resolve script/settings paths against the wrong
    // root, which would either error confusingly ("script file not found")
    // or, worse, write a relative `Bash(tools/<name>:*)` rule that can't
    // match a $HOME-rooted session's allowlist — issue #36.
    const home = resolveHome();
    if (home && sameFile(regPath, userRegistryPath(home))) {
      return {
        error:
          `Error: this session's project root is the home directory, so the "project" registry ` +
          `(${regPath}) is actually the user-scope registry. Re-run with --user so paths resolve ` +
          `against ~/.claude/toolsmith/ correctly.\n`,
      };
    }
    return {
      kind: 'project',
      normalize: normalizePath,
      normalizeStaged: normalizeStagedProjectPath,
      regPath,
      settingsFile: settingsPath(root),
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
    };
  }
  const home = resolveHome();
  if (!home) return null;
  return {
    kind: 'user',
    normalize: normalizeUserPath,
    normalizeStaged: normalizeUserStagedPath,
    regPath: userRegistryPath(home),
    settingsFile: userSettingsPath(home),
    scriptAbs: (path) => resolve(home, '.claude', 'toolsmith', path),
    stagedAbs: (stagedPath) => resolve(home, '.claude', 'toolsmith', stagedPath),
    ruleFor: (_path, scriptAbs) => `Bash(${scriptAbs}:*)`,
    displayPath: (_path, scriptAbs) => scriptAbs,
    invalidPathMessage: (rawPath) =>
      `Error: invalid tool "${rawPath}". Expected a bare tool name or "tools/<name>", with no ` +
      `".." segments, resolving under ~/.claude/toolsmith/tools/. Nothing written.\n`,
    invalidStagedPathMessage: (rawPath) =>
      `Error: invalid staged tool "${rawPath}" in the registry entry. Expected "staging/<name>", ` +
      `with no ".." segments, resolving under ~/.claude/toolsmith/staging/. Nothing written.\n`,
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

function sha256OfBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256OfFile(absPath) {
  return sha256OfBytes(readFileSync(absPath));
}

/**
 * Atomically write `content` (a string or a Buffer) to `path`: write to a
 * temp file in the same directory, then rename over the target. Ensures
 * readers never observe a partial write, and a crash mid-write leaves the
 * original file intact. Used for both the registry JSON (string) and the
 * placed executable's bytes (Buffer) — the promotion apply-step's "atomic
 * place" per docs/toolsmith/staged-live-split.md §Promotion.
 */
function atomicWrite(path, content) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmpDir = mkdtempSync(join(dir, '.toolsmith-approve-'));
  const tmpFile = join(tmpDir, 'tmp');
  try {
    if (Buffer.isBuffer(content)) writeFileSync(tmpFile, content);
    else writeFileSync(tmpFile, content, 'utf8');
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

// --- write-denial layer 1: mode + BSD immutable flag ------------------------
// docs/toolsmith/staged-live-split.md §Write denial, layer 1. `chflags` is a
// BSD/macOS-only utility (the program's stated same-user macOS constraint);
// on a platform without it (e.g. Linux CI), this degrades gracefully to
// mode-only protection and a warning — never a hard failure, since layers 2
// and 3 still hold without it.

let _chflagsAvailable;
function chflagsAvailable() {
  if (_chflagsAvailable === undefined) {
    try {
      const r = spawnSync('which', ['chflags'], { stdio: 'ignore' });
      _chflagsAvailable = r.status === 0;
    } catch {
      _chflagsAvailable = false;
    }
  }
  return _chflagsAvailable;
}

/** Best-effort `chflags <flag> <absPath>`. Never throws. */
function tryChflags(flag, absPath) {
  if (!chflagsAvailable()) {
    return { ok: false, reason: 'chflags is not available on this platform (non-macOS/BSD)' };
  }
  try {
    const r = spawnSync('chflags', [flag, absPath], { stdio: 'pipe' });
    if (r.status !== 0) {
      const stderr = r.stderr ? r.stderr.toString().trim() : '';
      return { ok: false, reason: stderr || `chflags ${flag} exited with status ${r.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Test-only fault injection: exits immediately after the named apply step,
 * simulating a promotion killed mid-manifest so the regression suite can
 * assert the apply is idempotent (AC4 — kill between place and pin-write,
 * re-run converges). Never engages unless TOOLSMITH_APPROVE_KILL_AFTER is set
 * to that exact step name, which only the test harness ever does.
 */
function killAfter(step) {
  if (process.env.TOOLSMITH_APPROVE_KILL_AFTER === step) {
    process.stderr.write(`[toolsmith-approve test fault injection] killed after step "${step}"\n`);
    process.exit(9);
  }
}

/**
 * Test-only fault injection: if TOOLSMITH_APPROVE_CORRUPT_REGISTRY_STEP6 is
 * set, clobbers the on-disk registry with invalid JSON immediately before
 * step 6 re-reads it, simulating a concurrent edit or on-disk corruption
 * between step 4's pin-write and step 6's read. Lets the regression suite
 * assert step 6 degrades gracefully (falls back to the in-memory
 * `toolsWithPin` state) instead of throwing. Never engages unless the env
 * var is set, which only the test harness ever does.
 */
function maybeCorruptRegistryForTest(regPath) {
  if (process.env.TOOLSMITH_APPROVE_CORRUPT_REGISTRY_STEP6 === '1') {
    writeFileSync(regPath, 'not valid json {{{ this simulates corruption', 'utf8');
  }
}

/**
 * Minimal unified-style line diff (old -> new), no external dependency.
 * Standard LCS-based diff; scripts are expected to be small (single-purpose
 * tools per the authoring checklist), so the O(n*m) table is fine. Used for
 * the promotion review surface (docs/toolsmith/staged-live-split.md
 * §Promotion, step 2): a revision is reviewed as a diff against live, so what
 * is reviewed is exactly what is placed.
 */
function unifiedLineDiff(oldText, newText) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < n) {
    lines.push(`- ${a[i]}`);
    i++;
  }
  while (j < m) {
    lines.push(`+ ${b[j]}`);
    j++;
  }
  return lines.join('\n');
}

/**
 * Rollout migration (docs/toolsmith/staged-live-split.md §Rollout): apply
 * write-denial layer 1 (0555 + uchg) to every already-approved live tool in
 * this scope that predates the staged/live split and so lacks the
 * protection. Idempotent and best-effort per file — folded into every
 * `approve` invocation rather than a separate one-time command, since after
 * the first pass every subsequent pass is a no-op (mode already 0555).
 * A single unreadable/missing tool is reported, never aborts the promotion
 * the caller actually asked for.
 */
function migrateProtection(registry, scope) {
  const notes = [];
  for (const tool of registry.tools) {
    if (!tool || tool.status !== 'approved' || typeof tool.path !== 'string') continue;
    const normalized = scope.normalize(tool.path);
    if (!normalized) continue;
    const abs = scope.scriptAbs(normalized);
    if (!existsSync(abs)) continue;
    let mode;
    try {
      mode = statSync(abs).mode & 0o777;
    } catch {
      continue;
    }
    if (mode === 0o555) continue; // already protected — nothing to do
    try {
      chmodSync(abs, 0o555);
    } catch (err) {
      notes.push(`Warning: could not protect pre-existing live tool ${abs}: ${err.message}`);
      continue;
    }
    const flagResult = tryChflags('uchg', abs);
    notes.push(
      flagResult.ok
        ? `Migrated pre-existing live tool ${abs} to 0555 + uchg.`
        : `Migrated pre-existing live tool ${abs} to 0555 (uchg unavailable: ${flagResult.reason}).`,
    );
  }
  return notes;
}

// --- approve/promote flow ---------------------------------------------------

function runApprove(rawPath, commit, userScope) {
  const scope = resolveScope(userScope);
  if (!scope) {
    process.stderr.write(`Error: could not resolve the home directory for --user. Nothing written.\n`);
    return 1;
  }
  if (scope.error) {
    process.stderr.write(scope.error);
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

  // The entry MUST carry a staged draft — promotion always moves bytes FROM
  // staging TO live; nothing is ever authored directly at the live path.
  const staged = entry.staged;
  if (!staged || typeof staged !== 'object' || typeof staged.path !== 'string') {
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

  let stagedBytes;
  try {
    stagedBytes = readFileSync(stagedAbs);
  } catch (err) {
    process.stderr.write(`Error: could not read ${stagedAbs}: ${err.message}. Nothing written.\n`);
    return 1;
  }
  const stagedSha = sha256OfBytes(stagedBytes);

  const liveAbs = scope.scriptAbs(path);
  const isRevision = existsSync(liveAbs);
  let liveTextBefore = '';
  if (isRevision) {
    try {
      liveTextBefore = readFileSync(liveAbs, 'utf8');
    } catch {
      liveTextBefore = '';
    }
  }

  const rule = scope.ruleFor(path, liveAbs);
  const settingsFile = scope.settingsFile;
  const existingSettings = existsSync(settingsFile) ? readJsonOrNull(settingsFile) : {};
  const alreadyGranted =
    existingSettings &&
    Array.isArray(existingSettings.permissions?.allow) &&
    existingSettings.permissions.allow.includes(rule);

  if (!commit) {
    const reviewSurface = isRevision
      ? unifiedLineDiff(liveTextBefore, stagedBytes.toString('utf8'))
      : stagedBytes.toString('utf8');
    process.stdout.write(
      [
        `Tool: ${entry.name ?? '(unnamed)'}`,
        `Kind: ${isRevision ? 'revision (diff against current live)' : 'new tool (full text)'}`,
        `Live path: ${scope.displayPath(path, liveAbs)}`,
        `Staged draft: ${staged.path}${staged.note ? ` — ${staged.note}` : ''}`,
        `Computed sha256 (staged): ${stagedSha}`,
        `Permission rule: ${rule}`,
        `Already in settings.json: ${alreadyGranted ? 'yes' : 'no'}`,
        '',
        '--- review surface ---',
        reviewSurface,
        '--- end review surface ---',
        '',
        'DRY RUN — nothing written; re-run without --dry-run to apply.',
      ].join('\n') + '\n',
    );
    return 0;
  }

  // --- commit: the apply manifest, executed deterministically -------------
  // Seal (docs/toolsmith/staged-live-split.md §Promotion, step 3): once #76
  // (attest-it admission) lands, promotion refuses without a valid seal over
  // the staged content. Deliberately NOT built here — this PR is scoped to
  // the staged/live split only. The command surface's proofread-then-confirm
  // handshake (commands/approve.md) is the interim stand-in named by the
  // canon ("Until #76: the existing approve confirmation stands in").
  //
  // Validate settings.json BEFORE any write, so a malformed/non-object
  // settings.json aborts the *entire* apply rather than placing live and then
  // clobbering settings.json. Fail-closed: the manifest either completes, or
  // stops with live untouched, at every step before "atomic place".
  const settingsCheck = readSettingsStrict(settingsFile);
  if (!settingsCheck.ok) {
    process.stderr.write(`Error: ${settingsCheck.reason} Nothing written.\n`);
    return 1;
  }

  // Rollout migration (§Rollout): protect any pre-existing approved live
  // tools in this scope that predate the split. Never touches the entry
  // being promoted right now (that gets protected by the manifest below
  // regardless), and never aborts this promotion on a per-file failure.
  const migrationNotes = migrateProtection(registry, scope);

  // Step 1: nouchg the live path, if it exists and carries the flag from a
  // prior promotion. `chflags` being absent on this platform is a known,
  // graceful degradation (write-denial layer 1's honest limit — see
  // docs/toolsmith/staged-live-split.md §Write denial) and must NOT abort
  // the promotion. A genuine `chflags nouchg` failure on a platform that DOES
  // have the binary (e.g. an unexpected permission wrinkle) is different: the
  // rename in step 2 would otherwise fail confusingly against a still-immutable
  // file, so abort BEFORE any write with a legible, actionable error. Live is
  // untouched at this point either way.
  if (isRevision && chflagsAvailable()) {
    const nouchgResult = tryChflags('nouchg', liveAbs);
    if (!nouchgResult.ok) {
      process.stderr.write(
        [
          `Error: could not clear the immutable flag before promotion.`,
          `  path: ${liveAbs}`,
          `  flag: uchg (chflags nouchg failed: ${nouchgResult.reason})`,
          `  Live is untouched — nothing was written.`,
          `  Remedy: run \`chflags nouchg ${liveAbs}\` by hand to diagnose (permissions, ownership), then re-run approve.`,
        ].join('\n') + '\n',
      );
      return 1;
    }
  }
  killAfter('nouchg');

  // Step 2: atomic place — write the staged bytes to a temp file in the live
  // directory, then rename over the live path. `atomicWrite` can still throw
  // (e.g. disk full, parent directory permissions) — the rename itself is
  // atomic, so a thrown error here means it did NOT happen: live is exactly
  // as it was before this promotion, never a partial write.
  try {
    atomicWrite(liveAbs, stagedBytes);
  } catch (err) {
    process.stderr.write(
      `Error: could not place the staged bytes at ${liveAbs}: ${err.message}. ` +
        `The place step is atomic (write to a temp file, then rename) — it either fully happens or not at all, ` +
        `and it did not: live is unchanged. Fix the underlying issue (disk space, parent directory permissions) and re-run approve.\n`,
    );
    return 1;
  }
  killAfter('place');

  // Step 3: chmod 0555 (r-x, no write bit) + uchg (best-effort BSD immutable
  // flag). This is write-denial layer 1 — see docs/toolsmith/staged-live-split.md.
  // chmodSync can throw (e.g. ownership mismatch); by this point the new
  // bytes are already placed but the registry pin (step 4) has not been
  // updated yet, so the live file's hash already mismatches the still-old
  // registered pin — invocation already fails closed (layer 3) on its own.
  // State this honestly rather than crashing: re-running approve converges.
  try {
    chmodSync(liveAbs, 0o555);
  } catch (err) {
    process.stderr.write(
      `Error: staged bytes were placed at ${liveAbs} but chmod 0555 failed: ${err.message}. ` +
        `Live now holds the new bytes but is neither mode-protected nor re-pinned; its hash no longer matches ` +
        `the registered pin, so invocation already fails closed. Re-run approve to converge.\n`,
    );
    return 1;
  }
  const uchgResult = tryChflags('uchg', liveAbs);
  killAfter('mode');

  // Step 4: recompute the pin from the bytes actually PLACED on disk — never
  // trust the staged.sha256 bookkeeping field or the sha computed before the
  // write (time-of-check != time-of-use guard, per the design-patterns rule).
  let placedBytes;
  try {
    placedBytes = readFileSync(liveAbs);
  } catch (err) {
    process.stderr.write(
      `Error: promotion placed ${liveAbs} but it could not be re-read to pin the hash: ${err.message}. ` +
        `Live is now in an unpinned state — re-run approve to converge.\n`,
    );
    return 1;
  }
  const placedSha = sha256OfBytes(placedBytes);

  const pinnedEntry = {
    ...entry,
    status: 'approved',
    approvedSha256: placedSha,
    permissionRule: rule,
  };
  const toolsWithPin = registry.tools.slice();
  toolsWithPin[idx] = pinnedEntry;
  atomicWrite(regPath, toJsonFile({ ...registry, tools: toolsWithPin }));
  killAfter('pin');

  // Step 5: ensure the permission rule is granted in the scope's settings.json.
  const settingsBefore = settingsCheck.value;
  const permissionsBefore =
    settingsBefore.permissions && typeof settingsBefore.permissions === 'object' ? settingsBefore.permissions : {};
  const allowBefore = Array.isArray(permissionsBefore.allow) ? permissionsBefore.allow : [];
  const allowAfter = allowBefore.includes(rule) ? allowBefore : [...allowBefore, rule];
  atomicWrite(
    settingsFile,
    toJsonFile({
      ...settingsBefore,
      permissions: { ...permissionsBefore, allow: allowAfter },
    }),
  );
  killAfter('rule');

  // Step 6: clear "staged" from the registry entry (a second registry write —
  // the promoted tool is no longer pending) and remove the staging file.
  // Re-read the registry from disk in case migrateProtection or a concurrent
  // process touched other entries; re-apply the same pin to this entry's slot.
  // If the re-read comes back missing entirely or with a corrupted/non-array
  // "tools" field (concurrent edit or on-disk corruption between step 4's
  // write and this read), fall back to the in-memory `toolsWithPin` state
  // from step 4 rather than throwing — the tool is already placed, pinned,
  // and granted at this point, so step 6 must degrade gracefully, not crash.
  maybeCorruptRegistryForTest(regPath);
  let registryAfterRule = readJsonOrNull(regPath);
  let staleRegistryNote = null;
  if (!registryAfterRule || !Array.isArray(registryAfterRule.tools)) {
    staleRegistryNote =
      `Warning: ${regPath} could not be re-read as a valid registry after the rule was granted ` +
      `(missing "tools" array — concurrent edit or corruption?); falling back to this promotion's ` +
      `in-memory state to clear "staged". Re-run approve if the registry looks wrong afterward.`;
    registryAfterRule = { ...registry, tools: toolsWithPin };
  }
  const idxAfterRule = registryAfterRule.tools.findIndex((t) => t && t.path === path);
  const finalTools = registryAfterRule.tools.slice();
  if (idxAfterRule !== -1) {
    const { staged: _staged, ...withoutStaged } = registryAfterRule.tools[idxAfterRule];
    finalTools[idxAfterRule] = withoutStaged;
  }
  atomicWrite(regPath, toJsonFile({ ...registryAfterRule, tools: finalTools }));

  try {
    if (existsSync(stagedAbs)) unlinkSync(stagedAbs);
  } catch (err) {
    process.stderr.write(`Warning: could not remove staged draft ${stagedAbs}: ${err.message}\n`);
  }

  process.stdout.write(
    [
      ...migrationNotes,
      ...(staleRegistryNote ? [staleRegistryNote] : []),
      `Promoted ${staged.path} -> ${scope.displayPath(path, liveAbs)}`,
      `Pinned: status=approved, approvedSha256=${placedSha}`,
      `permissionRule set to: ${rule}`,
      allowBefore.includes(rule)
        ? `Rule already present in ${settingsFile} (no-op).`
        : `Added rule to ${settingsFile} permissions.allow.`,
      `Live file mode: 0555${uchgResult.ok ? ' + uchg' : ` (uchg unavailable: ${uchgResult.reason})`}.`,
      `Staging draft removed.`,
    ].join('\n') + '\n',
  );
  return 0;
}

// --- verify flow (unchanged: checks the LIVE pin only, per contract §2) ---

function runVerify(rawPath, userScope) {
  const scope = resolveScope(userScope);
  if (!scope) {
    process.stderr.write(`Error: could not resolve the home directory for --user.\n`);
    return 1;
  }
  if (scope.error) {
    process.stderr.write(scope.error);
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
