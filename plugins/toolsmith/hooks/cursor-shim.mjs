// Generated Cursor controller-hook shim runner. Do not edit directly.
// Translates a Claude-authored gating hook's stdin/stdout contract to Cursor's and enforces
// fail-closed. See docs/specs/cursor-controller-shim.md (issue #37). Author the source
// hooks/claude.yaml and run "aipm build" — the sentinel lives in cursor-shim.mjs.generated.
import { spawnSync } from 'node:child_process';

// Inverse of the transform's CLAUDE_TO_CURSOR_TOOLS (Shell -> Bash; identity otherwise).
// Generated from the exported CURSOR_TO_CLAUDE_TOOLS const — the single source of truth.
const CURSOR_TO_CLAUDE_TOOLS = {
  "Edit": "Edit",
  "Grep": "Grep",
  "Read": "Read",
  "Shell": "Bash",
  "Write": "Write",
};

// The two gating Cursor events this shim handles, mapped to their Claude event names.
const CURSOR_TO_CLAUDE_EVENTS = {
  preToolUse: 'PreToolUse',
  beforeSubmitPrompt: 'UserPromptSubmit',
};

const argv = process.argv.slice(2);
const cursorEvent = argv[0];

function denyControl(reason) {
  if (cursorEvent === 'beforeSubmitPrompt') {
    return { continue: false, user_message: reason };
  }
  return { permission: 'deny', agent_message: reason };
}

function allowControl() {
  if (cursorEvent === 'beforeSubmitPrompt') {
    return { continue: true };
  }
  return { permission: 'allow' };
}

// Write the control JSON, then exit ONLY after stdout has flushed. A bare process.exit() right after
// a write can truncate a pipe-buffered payload — on the allow path that yields malformed JSON and
// Cursor blocks a legitimately-allowed tool. Exiting from the write callback drains it first.
function emitAndExit(control, code) {
  process.stdout.write(JSON.stringify(control), () => {
    process.exit(code);
  });
}

function failClosed(reason) {
  emitAndExit(denyControl(reason), 2);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

// Cursor -> Claude stdin translation (spec 4.1).
function translateCursorToClaude(cursorPayload) {
  const out = Object.assign({}, cursorPayload);
  out.hook_event_name = CURSOR_TO_CLAUDE_EVENTS[cursorEvent];
  if (typeof cursorPayload.tool_name === 'string') {
    out.tool_name = CURSOR_TO_CLAUDE_TOOLS[cursorPayload.tool_name] || cursorPayload.tool_name;
  }
  if (out.session_id === undefined && typeof cursorPayload.conversation_id === 'string') {
    out.session_id = cursorPayload.conversation_id;
  }
  return out;
}

// Claude PreToolUse handler output -> Cursor preToolUse control (spec 4.2).
function interpretPreToolUse(parsed) {
  if (parsed && typeof parsed === 'object') {
    const hso = parsed.hookSpecificOutput;
    let permission;
    let agentMessage;
    let additionalContext;
    let updatedInput;
    if (hso && typeof hso === 'object') {
      const decision = hso.permissionDecision;
      if (decision === 'allow' || decision === 'deny' || decision === 'ask') permission = decision;
      if (typeof hso.permissionDecisionReason === 'string') agentMessage = hso.permissionDecisionReason;
      if (hso.additionalContext !== undefined) additionalContext = hso.additionalContext;
    }
    if (permission === undefined && parsed.decision === 'block') {
      permission = 'deny';
      if (typeof parsed.reason === 'string') agentMessage = parsed.reason;
    }
    if (permission === undefined && parsed.continue === false) {
      permission = 'deny';
    }
    if (parsed.updatedInput !== undefined) updatedInput = parsed.updatedInput;
    if (permission !== undefined) {
      const control = { permission: permission };
      if (agentMessage !== undefined) control.agent_message = agentMessage;
      if (additionalContext !== undefined) control.additional_context = additionalContext;
      if (updatedInput !== undefined) control.updated_input = updatedInput;
      return control;
    }
    if (additionalContext !== undefined) {
      return { permission: 'allow', additional_context: additionalContext };
    }
  }
  return { permission: 'allow' };
}

// Claude UserPromptSubmit handler output -> Cursor beforeSubmitPrompt control (spec 4.2).
function interpretUserPromptSubmit(parsed) {
  if (parsed && typeof parsed === 'object') {
    let additionalContext;
    const hso = parsed.hookSpecificOutput;
    if (hso && typeof hso === 'object' && hso.additionalContext !== undefined) {
      additionalContext = hso.additionalContext;
    }
    if (parsed.decision === 'block' || parsed.continue === false) {
      const control = { continue: false };
      if (typeof parsed.reason === 'string') control.user_message = parsed.reason;
      return control;
    }
    const control = { continue: true };
    if (additionalContext !== undefined) control.additional_context = additionalContext;
    return control;
  }
  return { continue: true };
}

function interpret(parsed) {
  return cursorEvent === 'beforeSubmitPrompt'
    ? interpretUserPromptSubmit(parsed)
    : interpretPreToolUse(parsed);
}

// Best-effort reason extraction from a denying handler's stdout (used when it exits non-zero).
function extractHandlerReason(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.reason === 'string') return parsed.reason;
      const hso = parsed.hookSpecificOutput;
      if (hso && typeof hso === 'object' && typeof hso.permissionDecisionReason === 'string') {
        return hso.permissionDecisionReason;
      }
    }
  } catch (_err) {
    // Not JSON — nothing to extract.
  }
  return undefined;
}

async function main() {
  // argv shape: <cursorEvent> -- <handler command string>
  const sep = argv.indexOf('--');
  if (
    cursorEvent === undefined ||
    CURSOR_TO_CLAUDE_EVENTS[cursorEvent] === undefined ||
    sep < 1 ||
    sep === argv.length - 1
  ) {
    failClosed('cursor-shim: invalid arguments; expected <cursorEvent> -- <handler command>');
    return;
  }
  // Everything after '--' is the handler command string. Under real Cursor it arrives as a single
  // POSIX-single-quoted token (the transform quotes it), so this is one element; joining is a no-op
  // there and reconstitutes a space-joined command in any other invocation.
  const handlerCommand = argv.slice(sep + 1).join(' ');

  let rawStdin;
  try {
    rawStdin = await readStdin();
  } catch (_err) {
    failClosed('cursor-shim: failed to read stdin');
    return;
  }

  let cursorPayload;
  try {
    cursorPayload = rawStdin.trim() === '' ? {} : JSON.parse(rawStdin);
  } catch (_err) {
    failClosed('cursor-shim: malformed Cursor payload on stdin');
    return;
  }

  const claudePayload = translateCursorToClaude(cursorPayload);

  // Run the handler through a shell (shell: true) to match Claude's own 'sh -c' hook execution, so a
  // handler command using env-var refs, quoting, or other shell features execs correctly. The
  // command is the plugin author's own trusted hook (exactly as under Claude) — shell execution is
  // intended. An explicit generous maxBuffer avoids the default-1MB spawn-failure misread (spec 4.4).
  const result = spawnSync(handlerCommand, {
    shell: true,
    input: JSON.stringify(claudePayload),
    encoding: 'utf8',
    maxBuffer: 67108864,
  });

  // A genuine spawn failure (the shell itself never ran -> null status) is a fail-closed condition.
  // A handler that runs and exits non-zero yields a real status and is handled below; a benign stdin
  // write error (EPIPE) when a handler exits before draining stdin also keeps a valid exit status.
  if (result.error && result.status === null) {
    failClosed('cursor-shim: handler spawn failed: ' + String(result.error.message));
    return;
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const code = result.status;

  // Fail closed on any non-zero exit (never rely on Cursor's fail-open default).
  if (code !== 0) {
    const reason = extractHandlerReason(stdout.trim());
    failClosed(reason !== undefined ? reason : 'cursor-shim: handler exited with a non-zero status');
    return;
  }

  const trimmed = stdout.trim();
  // Exit 0 with no output: the handler declined to gate -> allow / continue.
  if (trimmed === '') {
    emitAndExit(allowControl(), 0);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_err) {
    failClosed('cursor-shim: handler emitted malformed JSON output');
    return;
  }

  emitAndExit(interpret(parsed), 0);
}

main().catch((err) => {
  failClosed('cursor-shim: internal error: ' + String(err && err.message ? err.message : err));
});
