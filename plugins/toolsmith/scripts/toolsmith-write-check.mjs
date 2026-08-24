#!/usr/bin/env node
/**
 * toolsmith-write-check: PreToolUse "brain" for write-denial layer 2
 * (docs/toolsmith/staged-live-split.md §"Write denial on live: mechanism and
 * honest limits", layer 2 — harness permission deny on the agent's own
 * editing tools, in front of the filesystem mode/uchg layer and the
 * integrity-pin backstop in toolsmith-check.mjs).
 *
 * Denies Write/Edit/NotebookEdit whose target path resolves under a scope's
 * LIVE tool directory or either scope's settings.json:
 *
 *   - project live dir:  <project>/scripts/agent-tools/
 *   - user live dir:     ~/.claude/toolsmith/tools/
 *   - project settings:  <project>/.claude/settings.json
 *   - user settings:     ~/.claude/settings.json
 *
 * Staging directories (.claude/toolsmith/staging/ in either scope) are
 * deliberately never checked here — the agent is expected to write there
 * constantly; that write activity is exactly what the staged/live split is
 * for.
 *
 * This rule is unconditional: it fires even when no registry exists (there
 * is nothing to "opt into" — a live path or a settings.json is protected
 * regardless), unlike toolsmith-check.mjs's registry-gated redirect logic.
 *
 * Fail-open: any infrastructure error (bad stdin, unreadable paths) exits 0
 * so a hook bug can never brick the user's editing tools. The permission
 * system, not this hook, is the security boundary; this is a guidance layer
 * (layer 1 — filesystem mode/uchg — and layer 3 — the integrity pin — are the
 * layers that actually hold when this one can't fire, e.g. an unsupported
 * host).
 *
 * Escape hatch: CLAUDE_TOOLSMITH_HOOK=off disables the hook entirely (shared
 * with toolsmith-check.mjs).
 *
 * @see docs/toolsmith/staged-live-split.md
 * @see https://code.claude.com/docs/en/hooks.md
 */
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

function main() {
  if (process.env.CLAUDE_TOOLSMITH_HOOK === 'off') return;

  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return; // fail-open
  }

  if (!['Write', 'Edit', 'NotebookEdit'].includes(input.tool_name)) return;
  const evt = input.hook_event_name;
  if (evt && evt !== 'PreToolUse' && evt !== 'preToolUse') return;
  // Write/Edit/NotebookEdit are named identically on every host this plugin
  // ships hooks for (unlike Bash/Shell), so there is no tool-name signal to
  // disambiguate Cursor here. Cursor's own preToolUse event name is
  // lowercase (mirrors the evt check above and toolsmith-check.mjs's isCursor
  // detection, which uses whatever signal is actually available per event).
  const isCursor = evt === 'preToolUse';

  const rawPath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof rawPath !== 'string' || !rawPath.trim()) return;

  const root = projectRoot(input);
  const home = resolveHome();

  const target = resolvePath(rawPath, root, home);
  if (!target) return; // fail-open: couldn't resolve, don't guess

  const liveDirs = [
    { dir: join(root, 'scripts', 'agent-tools'), scope: 'project' },
    ...(home ? [{ dir: join(home, '.claude', 'toolsmith', 'tools'), scope: 'user' }] : []),
  ];
  for (const { dir } of liveDirs) {
    if (isUnder(target, resolveExistingOrLexical(dir))) {
      deny(
        `Live toolsmith tools are write-protected (staged/live split — ` +
          `docs/toolsmith/staged-live-split.md). Author your change under the ` +
          `matching staging directory (\`.claude/toolsmith/staging/\` for a ` +
          `project tool, \`~/.claude/toolsmith/staging/\` for a user tool) ` +
          `instead, then have the user run \`/toolsmith:approve\` to promote it.`,
        isCursor,
      );
      return;
    }
  }

  const settingsPaths = [
    join(root, '.claude', 'settings.json'),
    ...(home ? [join(home, '.claude', 'settings.json')] : []),
  ];
  for (const settingsPath of settingsPaths) {
    if (samePath(target, resolveExistingOrLexical(settingsPath))) {
      deny(
        `Permission grants in settings.json are only made by the toolsmith ` +
          `promotion handshake (\`/toolsmith:approve\`), never by a direct ` +
          `edit. Run \`/toolsmith:approve\` to add or change a rule.`,
        isCursor,
      );
      return;
    }
  }
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

function projectRoot(input) {
  return process.env.CLAUDE_PROJECT_DIR || process.env.CURSOR_PROJECT_DIR || input.cwd || process.cwd();
}

/**
 * Expand `~`, resolve relative paths against `root`, then defensively resolve
 * symlinks: realpath the nearest existing ancestor (so a symlinked project
 * root or a symlinked parent directory can't be used to sneak a target out
 * from under a live dir / settings.json check) and rejoin whatever tail of
 * the path doesn't exist yet (the file being newly created). Never throws;
 * returns null on any failure so the caller fails open.
 */
function resolvePath(rawPath, root, home) {
  try {
    let expanded = rawPath.trim();
    if (expanded === '~') {
      expanded = home || expanded;
    } else if (expanded.startsWith('~/')) {
      expanded = home ? join(home, expanded.slice(2)) : expanded;
    }
    const absolute = resolve(root, expanded);
    return resolveExistingOrLexical(absolute);
  } catch {
    return null;
  }
}

/**
 * realpath() the nearest existing ancestor of `p` and rejoin the remaining
 * (not-yet-existing) tail, so a symlink anywhere in an existing prefix is
 * defeated even though the file itself doesn't exist yet. Falls back to the
 * plain lexical resolution if no ancestor exists or realpath fails.
 */
function resolveExistingOrLexical(p) {
  const target = resolve(p);
  const segments = [];
  let cur = target;
  while (true) {
    if (existsSync(cur)) {
      try {
        const real = realpathSync(cur);
        return segments.length ? join(real, ...segments) : real;
      } catch {
        break;
      }
    }
    const parent = dirname(cur);
    if (parent === cur) break; // reached filesystem root without finding an existing ancestor
    segments.unshift(cur.slice(parent.length + 1));
    cur = parent;
  }
  return target;
}

function samePath(a, b) {
  return resolve(a) === resolve(b);
}

function isUnder(target, dir) {
  const t = resolve(target);
  const d = resolve(dir);
  return t === d || t.startsWith(d + sep);
}

// Emit the deny in the shape the calling host understands — mirrors
// toolsmith-check.mjs's deny() (see its comment for why only one shape is
// emitted, never both).
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
