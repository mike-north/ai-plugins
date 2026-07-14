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
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // Cursor speaks a different deny contract than Claude/Codex; detect by the
  // tool name so we emit the shape the calling host understands.
  const isCursor = input.tool_name === 'Shell';

  const command = input.tool_input?.command;
  if (typeof command !== 'string' || !command.trim()) return;

  const root = projectRoot(input);
  const registry = readJson(join(root, '.claude', 'toolsmith', 'registry.json'));
  const tools = Array.isArray(registry?.tools) ? registry.tools : [];

  // Step 1 — hash-pin. If the command invokes a registered tool, that fully
  // governs the decision (allow or deny); never fall through to redirect.
  const invoked = tools.find((t) => t && typeof t.path === 'string' && invokesTool(command, t));
  if (invoked) {
    const denial = hashDenial(invoked, root);
    if (denial) deny(denial, isCursor);
    return; // approved + matching hash → allow through untouched
  }

  // Step 2 — redirect. Only meaningful if the command is watched.
  const config = readJson(join(root, '.claude', 'toolsmith', 'config.json'));
  const watchlist = effectiveWatchlist(config);
  if (!watchlist.some((re) => safeTest(re, command))) return;

  for (const tool of tools) {
    if (tool?.status !== 'approved') continue;
    const covers = Array.isArray(tool.covers) ? tool.covers : [];
    const hit = covers.some((pat) => safeTest(toRegExp(pat), command));
    if (!hit) continue;
    const call = `${tool.name}${tool.args ? ' ' + tool.args : ''}`;
    deny(
      `A purpose-built, pre-approved tool already covers this. Use \`${call}\` instead ` +
        `of a one-off command — ${tool.purpose || 'see the registry'}. ` +
        `It exists precisely so this narrow operation is allowlisted while the broad ` +
        `command stays gated. Path: ${tool.path}. ` +
        `If it genuinely does not fit, tell the user why and ask them to run the raw command.`,
      isCursor,
    );
    return;
  }
  // Watched but uncovered → allow through to the normal permission flow.
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
function hashDenial(tool, root) {
  if (tool.status !== 'approved') {
    return (
      `\`${tool.name}\` is registered but not yet approved. Have the user proofread it, ` +
      `then run \`/toolsmith:approve ${tool.path}\` before using it.`
    );
  }
  const abs = isAbsolute(tool.path) ? tool.path : join(root, tool.path);
  let contents;
  try {
    contents = readFileSync(abs);
  } catch {
    return (
      `\`${tool.name}\` is approved in the registry but its file (${tool.path}) could not be ` +
      `read. Restore it or re-run \`/toolsmith:approve ${tool.path}\`.`
    );
  }
  const sha = createHash('sha256').update(contents).digest('hex');
  if (sha !== tool.approvedSha256) {
    return (
      `\`${tool.name}\` (${tool.path}) has changed since it was approved (sha256 mismatch), so ` +
      `its prior approval no longer applies. Have the user re-review the new contents and run ` +
      `\`/toolsmith:approve ${tool.path}\` to re-pin it.`
    );
  }
  return null;
}

/** Effective watchlist regexes = shipped defaults − config.remove + config.add. */
function effectiveWatchlist(config) {
  const defaults = readJson(DEFAULT_WATCHLIST_PATH);
  const defaultPatterns = Array.isArray(defaults?.watchlist)
    ? defaults.watchlist.map((e) => e.pattern).filter((p) => typeof p === 'string')
    : [];
  const remove = new Set(
    Array.isArray(config?.watchlist?.remove) ? config.watchlist.remove : [],
  );
  const add = Array.isArray(config?.watchlist?.add) ? config.watchlist.add : [];
  const patterns = [...defaultPatterns.filter((p) => !remove.has(p)), ...add];
  // Multiline so a `^`-anchored pattern still matches a watched command that
  // appears on a later line of a multi-line command string.
  return patterns.map((p) => toRegExp(p, 'm')).filter(Boolean);
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
