#!/usr/bin/env node
/**
 * toolsmith-check: PreToolUse "brain" for the toolsmith plugin.
 *
 * Spawned by toolsmith-gate.sh only when a Bash command is a plausible
 * candidate (references a registered tool, or hits a coarse watch token, or a
 * project config exists). It makes the precise decision:
 *
 *   1. Hash-pin — if the command invokes a registered tool, the tool must be
 *      status:approved AND its on-disk sha256 must match approvedSha256.
 *      Otherwise DENY (the script was edited or never approved). A matching
 *      approved tool is ALLOWED through to the normal permission flow (the
 *      user's `Bash(path:*)` allowlist rule auto-approves it).
 *
 *   2. Redirect — if the command matches the effective watchlist (shipped
 *      defaults ± project config) and an approved tool's `covers` pattern
 *      matches it, DENY and name the tool to use instead. A watched command
 *      with no covering tool is ALLOWED (never block novel uses).
 *
 * Fail-open: any infrastructure error (bad stdin, unreadable files) exits 0
 * so a hook bug can never brick the user's shell. The permission system, not
 * this hook, is the security boundary; this is a guidance/redirect layer.
 *
 * Escape hatch: CLAUDE_TOOLSMITH_HOOK=off disables the hook entirely.
 *
 * @see https://code.claude.com/docs/en/hooks.md
 */
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, isAbsolute, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WATCHLIST_PATH = join(
  SCRIPT_DIR,
  '..',
  'skills',
  'toolsmith',
  'references',
  'watchlist-defaults.json',
);

function main() {
  if (process.env.CLAUDE_TOOLSMITH_HOOK === 'off') return;

  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return; // fail-open
  }
  // The Bash-tool matcher is called `Bash` on Claude/Codex and `Shell` on
  // Cursor (its preToolUse hook). Accept either; anything else is not ours.
  if (input.tool_name !== 'Bash' && input.tool_name !== 'Shell') return;
  // Event name is `PreToolUse` (Claude/Codex) or `preToolUse` (Cursor); some
  // hosts omit it. Only reject a clearly-different event.
  const evt = input.hook_event_name;
  if (evt && evt !== 'PreToolUse' && evt !== 'preToolUse') return;
  // Legacy direct-wiring compatibility: since PR #32, the shipped cursor.json
  // routes Cursor's preToolUse through the emitted cursor-shim.mjs, which
  // rewrites `Shell` -> `Bash` and translates the deny shape itself before
  // this script ever sees the event — so on the current shipped wiring,
  // `tool_name` is always `Bash` here and this branch is unreachable. But
  // installs still running a pre-0.7.0-toolkit version of the plugin ship
  // the pre-shim cursor.json, which feeds `Shell` directly into this script,
  // so we still need to detect it and emit Cursor's own deny contract for
  // those installs. Keep this branch until pre-shim installs are plausibly
  // gone.
  //
  // This IS the kind of hand-rolled Shell/Bash harness-detection branching
  // #34 wants handlers to stop doing in favor of payload-adapter's normalized
  // `harness.name`/`is_subagent` fields. It is a deliberate, benchmarked
  // exception for the PreToolUse Bash hot path specifically: #38 measured
  // that piping the adapter (sh + jq) ahead of toolsmith-gate.sh roughly
  // doubles the cost of the not-opted-in no-op path (the one path whose
  // entire reason for existing is that it's ~free for shells that never
  // opted into toolsmith), so adoption was declined here and #34 was updated
  // to scope its criterion around this exception rather than re-litigate it
  // per PR. The PostToolUse logger and dream's Stop hook are not on a hot
  // path and are unaffected — see #38.
  const isCursor = input.tool_name === 'Shell';

  const command = input.tool_input?.command;
  if (typeof command !== 'string' || !command.trim()) return;

  const root = projectRoot(input);

  // User scope: tools defined once in ~/.claude/toolsmith/registry.json and
  // reused across every project. Resolved defensively — if the home
  // directory can't be determined, the user scope is simply empty (never
  // crash the fail-open hook over it).
  const home = resolveHome();
  const userToolsDir = home ? join(home, '.claude', 'toolsmith') : null;
  const userRegistryPath = userToolsDir ? join(userToolsDir, 'registry.json') : null;
  const projectRegistryPath = join(root, '.claude', 'toolsmith', 'registry.json');

  // The project registry path and the user registry path resolve to the same
  // file when the session's project root IS the home directory (a session
  // rooted at `~`, or at a path that resolves to it via symlink). Ingesting that
  // file a second time as "project scope" mis-tags every entry: a user
  // tool's `path` is relative to `<home>/.claude/toolsmith/`, not to `root`,
  // so hashDenial() resolves the wrong on-disk file (false "could not be
  // read" denials) and displayPath() emits the relative `tools/<name>` form,
  // which can't match the user's absolute `Bash(<abs>:*)` allowlist rule.
  // The fix is to treat the project registry as empty in that case and let
  // the genuine user-scope ingestion below (which resolves paths correctly)
  // handle everything — issue #36.
  const projectIsUserRegistry = Boolean(userRegistryPath) && sameFile(projectRegistryPath, userRegistryPath);

  const registry = projectIsUserRegistry ? null : readJson(projectRegistryPath);
  const projectTools = Array.isArray(registry?.tools) ? registry.tools : [];
  const projectNames = new Set(projectTools.filter((t) => t && typeof t.path === 'string').map((t) => t.name));

  const userRegistry = userToolsDir ? readJson(userRegistryPath) : null;
  const rawUserTools = Array.isArray(userRegistry?.tools) ? userRegistry.tools : [];
  // Project shadows user on name collision: a user tool whose `name` matches
  // a project tool is ignored entirely while the project defines it.
  const userTools = rawUserTools
    .filter((t) => t && typeof t.path === 'string' && isUserToolPath(t.path))
    .filter((t) => !projectNames.has(t.name))
    .map((t) => ({ ...t, _scope: 'user', _root: userToolsDir }));

  const tools = [...projectTools.map((t) => ({ ...t, _scope: 'project', _root: root })), ...userTools];

  // Step 1 — hash-pin. If the command invokes a registered tool, that fully
  // governs the decision (allow or deny); never fall through to redirect.
  // Project tools are listed first, so a basename collision resolves in the
  // project's favor (project precedence).
  const invoked = tools.find((t) => t && typeof t.path === 'string' && invokesTool(command, t));
  if (invoked) {
    const denial = hashDenial(invoked);
    if (denial) deny(denial, isCursor);
    return; // approved + matching hash → allow through untouched
  }

  // Step 2 — redirect. Only meaningful if the command is watched.
  const projectConfigPath = join(root, '.claude', 'toolsmith', 'config.json');
  const userConfigPath = userToolsDir ? join(userToolsDir, 'config.json') : null;
  // Same $HOME-rooted-session conflation as the registry (issue #36): when the
  // project root IS the home dir, the user and project config files are the
  // same file. Reading it as both layers would apply its `add`/`remove`
  // twice, which is a no-op for `add` (union) but is exactly the kind of
  // double-application the acceptance criteria call out — so read it once.
  const projectIsUserConfig = Boolean(userConfigPath) && sameFile(projectConfigPath, userConfigPath);
  const userConfig = !projectIsUserConfig && userConfigPath ? readJson(userConfigPath) : null;
  const projectConfig = readJson(projectConfigPath);
  const watchlist = effectiveWatchlist(userConfig, projectConfig);
  if (!watchlist.some((re) => safeTest(re, command))) return;

  for (const tool of tools) {
    if (tool?.status !== 'approved') continue;
    const covers = Array.isArray(tool.covers) ? tool.covers : [];
    const hit = covers.some((pat) => safeTest(toRegExp(pat), command));
    if (!hit) continue;
    // The runnable command MUST be the path form (relative for a project
    // tool, fully-expanded absolute for a user tool) because that is what
    // the allowlist's `Bash(<path>:*)` rule actually matches. Telling the
    // agent to "use `<name>`" would run the bare name, miss the rule, and
    // still trigger a permission prompt — defeating the whole redirect.
    const call = `${displayPath(tool)}${tool.args ? ' ' + tool.args : ''}`;
    deny(
      `A purpose-built, pre-approved tool already covers this. Run \`${call}\` (the approved ` +
        `\`${tool.name}\` tool) instead of a one-off command — ${tool.purpose || 'see the registry'}. ` +
        `It exists precisely so this narrow operation is allowlisted while the broad ` +
        `command stays gated. ` +
        `If it genuinely does not fit, tell the user why and ask them to run the raw command.`,
      isCursor,
    );
    return;
  }
  // Watched but uncovered → allow through to the normal permission flow.
}

/** Resolve os.homedir() defensively: never let a homedir failure crash the fail-open hook. */
function resolveHome() {
  try {
    const h = homedir();
    return typeof h === 'string' && h ? h : null;
  } catch {
    return null;
  }
}

/**
 * True if two paths name the same file on disk. Used to detect the $HOME-
 * rooted-session conflation (issue #36) — see the call site's comment.
 * Prefers realpath so a symlinked $HOME is still caught; if either path
 * doesn't exist yet (realpath throws — e.g. neither registry has been
 * created), falls back to a plain resolved-path string comparison. Never
 * throws: this hook is fail-open.
 */
function sameFile(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

// Conservative safe character set — mirrors toolsmith-approve.mjs's
// normalizePath so a registry's `path` field can't smuggle traversal or
// shell-metacharacter noise into a resolved filesystem path.
const SAFE_PATH_CHARS = /^[A-Za-z0-9._/-]+$/;

/**
 * A user-tool registry entry's `path` MUST be `tools/<name>` (relative to
 * `<home>/.claude/toolsmith/`), with no traversal/absolute/unsafe segments —
 * anything else is rejected outright and the entry is treated as absent
 * rather than resolved onto an unintended filesystem location.
 */
function isUserToolPath(rawPath) {
  if (typeof rawPath !== 'string') return false;
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.includes('\\') || trimmed.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(trimmed)) return false;
  const stripped = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
  if (!stripped || stripped.startsWith('/') || !SAFE_PATH_CHARS.test(stripped)) return false;
  const segments = stripped.split('/');
  if (segments.some((seg) => seg === '..' || seg === '.' || seg === '')) return false;
  return segments[0] === 'tools';
}

/** The path to surface in a deny message: absolute for a user tool, project-relative otherwise. */
function displayPath(tool) {
  if (tool._scope === 'user' && tool._root) return join(tool._root, tool.path);
  return tool.path;
}

/**
 * Does `command` actually EXECUTE this tool (not merely mention its path as an
 * argument)? We split the command into simple-command segments and check the
 * executable position of each. This is critical: matching a bare path mention
 * would deny innocent commands like `cat <path>` or `git add <path>` — and,
 * worst, the `shasum -a 256 <path>` step in the re-approval flow, deadlocking
 * the plugin's own lifecycle.
 */
function invokesTool(command, tool) {
  const base = basename(tool.path);
  const names = new Set([tool.path, base]);
  if (typeof tool.name === 'string') names.add(tool.name);
  // A user tool is invoked by its fully-expanded absolute path (the form the
  // approve tool prints and the allowlist rule matches), or the equivalent
  // `~/`/`$HOME/`-prefixed shorthand a human/agent might type instead.
  if (tool._scope === 'user' && tool._root) {
    names.add(join(tool._root, tool.path));
    names.add(`~/.claude/toolsmith/${tool.path}`);
    names.add(`$HOME/.claude/toolsmith/${tool.path}`);
  }
  return commandSegments(command).some((seg) => {
    const exec = firstExecutable(seg);
    if (!exec) return false;
    const norm = exec.replace(/^\.\//, '');
    return names.has(exec) || names.has(norm) || basename(norm) === base;
  });
}

// Split on shell command separators (pipe, &&, ||, ;, &, newline). Not a full
// shell parser — good enough to isolate each simple command's executable.
function commandSegments(command) {
  return command.split(/\|\||&&|[|;&\n]/);
}

// Wrapper commands that exec another command, and the short/long option flags
// each one consumes an argument for. When a wrapper carries options, the real
// executable sits after them — e.g. `sudo -u root <tool>`, `env -i <tool>`,
// `env -u FOO <tool>`, `time -o out <tool>`. Missing this lets a draft or
// hash-drifted tool run via a wrapper unchecked, defeating the pin.
const WRAPPER_ARG_FLAGS = {
  sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user']),
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string', '--block-signal', '--default-signal', '--ignore-signal']),
  time: new Set(['-o', '-f', '--output', '--format']),
};
const WRAPPERS = new Set(['bash', 'sh', 'env', 'command', 'exec', 'sudo', 'nohup', 'time']);

// The executable token of a simple command: skip leading VAR=val assignments,
// then any wrapper words together with their option flags (and the operands of
// arg-taking flags) and env assignments, until the first real command token.
function firstExecutable(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  const isAssignment = (t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t);
  let i = 0;
  while (i < tokens.length && isAssignment(tokens[i])) i++;
  while (i < tokens.length && WRAPPERS.has(tokens[i])) {
    const argFlags = WRAPPER_ARG_FLAGS[tokens[i]];
    i++;
    // Consume this wrapper's options / assignments before its target command.
    while (i < tokens.length) {
      const t = tokens[i];
      if (isAssignment(t)) {
        i++;
      } else if (t.startsWith('-')) {
        i++;
        // A flag that takes a separate-token value consumes the next token too
        // (e.g. `-u root`). `--` (end-of-options) takes none.
        if (t !== '--' && argFlags && argFlags.has(t) && i < tokens.length) i++;
      } else {
        break;
      }
    }
  }
  return tokens[i] || null;
}

/** Returns a denial reason if the tool is unapproved or its hash drifted; else null. */
function hashDenial(tool) {
  const shown = displayPath(tool);
  const approveCmd = tool._scope === 'user' ? `/toolsmith:approve ${tool.path} --user` : `/toolsmith:approve ${tool.path}`;
  if (tool.status !== 'approved') {
    return (
      `\`${tool.name}\` is registered but not yet approved. Have the user proofread it, ` +
      `then run \`${approveCmd}\` before using it.`
    );
  }
  const abs = isAbsolute(tool.path) ? tool.path : join(tool._root, tool.path);
  let contents;
  try {
    contents = readFileSync(abs);
  } catch {
    return (
      `\`${tool.name}\` is approved in the registry but its file (${shown}) could not be ` +
      `read. Restore it or re-run \`${approveCmd}\`.`
    );
  }
  const sha = createHash('sha256').update(contents).digest('hex');
  if (sha !== tool.approvedSha256) {
    return (
      `\`${tool.name}\` (${shown}) has changed since it was approved (sha256 mismatch), so ` +
      `its prior approval no longer applies. Have the user re-review the new contents and run ` +
      `\`${approveCmd}\` to re-pin it.`
    );
  }
  return null;
}

/**
 * Effective watchlist = shipped defaults, then the user-scope config, then the
 * project-scope config, applied broad→specific: at each layer, `add` unions
 * in new patterns and `remove` subtracts a pattern present so far (a default,
 * or an `add` from a broader layer already applied) — so a project `remove`
 * can drop a pattern the user config just added, and a user `remove` can drop
 * a shipped default for every project.
 */
function effectiveWatchlist(userConfig, projectConfig) {
  const defaults = readJson(DEFAULT_WATCHLIST_PATH);
  const defaultPatterns = Array.isArray(defaults?.watchlist)
    ? defaults.watchlist.map((e) => e.pattern).filter((p) => typeof p === 'string')
    : [];
  let patterns = defaultPatterns;
  for (const config of [userConfig, projectConfig]) {
    patterns = applyWatchlistLayer(patterns, config);
  }
  // Multiline so a `^`-anchored pattern still matches a watched command that
  // appears on a later line of a multi-line command string.
  return patterns.map((p) => toRegExp(p, 'm')).filter(Boolean);
}

/** Apply one config layer's `remove` (verbatim match against patterns so far) then `add`. */
function applyWatchlistLayer(patterns, config) {
  const remove = new Set(Array.isArray(config?.watchlist?.remove) ? config.watchlist.remove : []);
  const add = Array.isArray(config?.watchlist?.add) ? config.watchlist.add : [];
  return [...patterns.filter((p) => !remove.has(p)), ...add];
}

function projectRoot(input) {
  return (
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.CURSOR_PROJECT_DIR ||
    input.cwd ||
    process.cwd()
  );
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function toRegExp(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function safeTest(re, s) {
  if (!re) return false;
  try {
    return re.test(s);
  } catch {
    return false;
  }
}

// Emit the deny in the shape the calling host understands. Claude/Codex read
// `hookSpecificOutput.permissionDecision`; Cursor reads a flat `permission`
// with user_message/agent_message. We emit only the host's shape (not both) so
// a host that rejects unknown fields can't fail the hook into a silent allow.
function deny(reason, isCursor) {
  const payload = isCursor
    ? { permission: 'deny', user_message: reason, agent_message: reason }
    : {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      };
  process.stdout.write(JSON.stringify(payload));
}

main();
