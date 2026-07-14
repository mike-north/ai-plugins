#!/usr/bin/env node
/**
 * toon-hook: route JSON-emitting Bash commands through the TOON encoder.
 *
 * One script, two Claude Code hook events (dispatched on hook_event_name):
 *
 * - PreToolUse  — when the final pipeline stage of the command carries a
 *   high-confidence JSON signal (a JSON output flag, a terminal non-raw `jq`,
 *   or a registry-confirmed signature), rewrite the command to append the
 *   toon-pipe wrapper as the FINAL stage. Never inserts mid-pipeline.
 * - PostToolUse — ground truth: if the actual output parses as a JSON
 *   object/array above a size threshold, replace the tool result with TOON
 *   (updatedToolOutput) and record the command signature in registry.json so
 *   PreToolUse can rewrite it at the source next time.
 *
 * Escape hatch: CLAUDE_TOON_HOOK=off disables both branches (and toon-pipe).
 *
 * @see https://code.claude.com/docs/en/hooks.md
 * @see https://github.com/toon-format/toon
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const TOON_PIPE = join(HOOK_DIR, "toon-pipe");
// Stable home-dir path (not next to the script): the script may live in a
// volatile plugin cache, and all installs should share one learned registry.
const REGISTRY_PATH =
  process.env.TOON_HOOK_REGISTRY ??
  join(homedir(), ".claude", "toon", "registry.json");

// Don't bother converting payloads smaller than this — savings are negligible.
const MIN_JSON_CHARS = 300;
// Confirmations required before a registry signature triggers a pre-rewrite.
const REGISTRY_MIN_COUNT = 2;
// Unparseable {/[-prefixed output at least this large is likely truncated JSON:
// learn the signature (so PreToolUse converts at the source) but don't convert.
const TRUNCATION_LEARN_CHARS = 20000;
// Never learn these as "JSON-emitting" — their output depends on arguments.
const NO_LEARN_COMMANDS = new Set(["echo", "printf", "cat", "head", "tail", "toon"]);
// Verbatim output the agent likely needs byte-exact (file dumps, its own
// echoed strings) — learn nothing from these and never convert them.
const NO_CONVERT_COMMANDS = new Set(["cat", "head", "tail", "echo", "printf"]);
// Matches `toon` / `toon-pipe` only as an invoked command STAGE — at the start
// of the command or right after a stage operator (| |& & && || ; ( ), with an
// optional path prefix. Deliberately does NOT match `toon` inside an argument
// (e.g. `gh api repos/toon-format/toon`), which must still be converted/learned.
// This is how we skip our own rewrites (`… | /abs/path/toon-pipe`) and commands
// that genuinely invoke toon, without suppressing unrelated commands.
const TOON_STAGE_RE = /(^|[|&;(])\s*(\S*\/)?toon(-pipe)?(\s|$)/;

function main() {
  if (process.env.CLAUDE_TOON_HOOK === "off") return;
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  if (input.tool_name !== "Bash") return;
  if (input.hook_event_name === "PreToolUse") preToolUse(input);
  else if (input.hook_event_name === "PostToolUse") postToolUse(input);
}

/**
 * Split a command into the pipeline stages of its FINAL top-level segment,
 * respecting quotes and backslash escapes. `a && b | c` → ["b", "c"].
 * Returns null on unbalanced quoting (be conservative: do nothing).
 */
function finalPipelineStages(command) {
  let stages = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      cur += ch;
      if (ch === "\\" && quote === '"') {
        cur += command[++i] ?? "";
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\\") {
      cur += ch + (command[++i] ?? "");
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    // A new top-level segment starts: everything before it is irrelevant.
    if ((ch === "&" || ch === "|") && command[i + 1] === ch) {
      stages = [];
      cur = "";
      i++;
      continue;
    }
    if (ch === ";") {
      stages = [];
      cur = "";
      continue;
    }
    // `|&` (bash: pipe stdout+stderr) is a pipe, not a new segment.
    if (ch === "|" && command[i + 1] === "&") {
      stages.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (ch === "|") {
      stages.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (quote) return null;
  stages.push(cur);
  const trimmed = stages.map((s) => s.trim());
  return trimmed.some((s) => !s) ? null : trimmed;
}

/** Whitespace-split a stage, keeping quoted spans intact. */
function words(stage) {
  return stage.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

/**
 * Command signature for the registry: the first two non-flag words, skipping
 * leading env assignments — e.g. `gh api repos/x/y --paginate` → "gh api".
 */
function signature(stage) {
  const toks = words(stage).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  const nonFlag = [];
  for (const t of toks) {
    if (t.startsWith("-")) continue;
    nonFlag.push(t);
    if (nonFlag.length === 2) break;
  }
  return nonFlag.join(" ");
}

const JSON_FLAG_RE =
  /(^|\s)(--json\b|--format[=\s]+["']?json\b|--output[=\s]+["']?json\b|-o[=\s]+["']?json\b)/;

/** Terminal `jq` emits JSON unless a raw-output flag is present. */
function isTerminalJq(stage) {
  const toks = words(stage);
  if (toks[0] !== "jq") return false;
  return !toks.some(
    (t) =>
      t === "--raw-output" ||
      t === "--join-output" ||
      t === "--ascii-output" ||
      (/^-[a-zA-Z]+$/.test(t) && /[rja]/.test(t)),
  );
}

function readRegistry() {
  try {
    const data = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function registryConfirms(sig) {
  if (!sig) return false;
  const entry = readRegistry().find((e) => e.sig === sig);
  return Boolean(entry && entry.count >= REGISTRY_MIN_COUNT);
}

/** Upsert a confirmed JSON-emitting signature. Atomic write (tmp + rename). */
function learn(stage) {
  const firstWord = words(stage)[0] ?? "";
  if (NO_LEARN_COMMANDS.has(firstWord)) return;
  const sig = signature(stage);
  if (!sig) return;
  const reg = readRegistry();
  const entry = reg.find((e) => e.sig === sig);
  if (entry) {
    entry.count += 1;
    entry.lastSeen = new Date().toISOString();
  } else {
    reg.push({ sig, count: 1, lastSeen: new Date().toISOString() });
  }
  try {
    mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
    const tmp = `${REGISTRY_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n");
    renameSync(tmp, REGISTRY_PATH);
  } catch {
    // Learning is best-effort; never fail the hook over it.
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function preToolUse(input) {
  const cmd = input.tool_input?.command;
  if (typeof cmd !== "string" || !cmd.trim()) return;
  // Conservative skips — PostToolUse safety-nets anything we pass on here.
  if (cmd.includes("\n") || cmd.includes("<<")) return;
  if (TOON_STAGE_RE.test(cmd)) return;
  if (/&\s*$/.test(cmd)) return;
  const stages = finalPipelineStages(cmd);
  if (!stages || stages.length === 0) return;
  const last = stages[stages.length - 1];
  // Any redirection (or shell comparison chars we can't cheaply disambiguate)
  // in the final stage → skip.
  if (/[<>]/.test(last)) return;
  const shouldRewrite =
    JSON_FLAG_RE.test(last) ||
    isTerminalJq(last) ||
    registryConfirms(signature(last));
  if (!shouldRewrite) return;
  // Placement invariant: toon-pipe is only ever APPENDED as the final stage of
  // the whole command — never inserted mid-pipeline.
  // No permissionDecision: returning only updatedInput leaves the normal
  // permission flow intact ("defer" is rejected by some harness versions,
  // and "allow" would silently auto-approve non-allowlisted commands).
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { command: `set -o pipefail; ${cmd} | ${TOON_PIPE}` },
    },
  });
}

function postToolUse(input) {
  const cmd = input.tool_input?.command ?? "";
  if (TOON_STAGE_RE.test(cmd)) return;
  const stages = finalPipelineStages(cmd) ?? [];
  const last = stages[stages.length - 1] ?? "";
  const firstWord = words(last)[0] ?? "";

  // Real Bash tool_response is {stdout, stderr, interrupted, isImage, ...};
  // older docs show {type: "text", text} — accept both, plus a bare string.
  const resp = input.tool_response;
  const text =
    typeof resp === "string"
      ? resp
      : typeof resp?.stdout === "string"
        ? resp.stdout
        : typeof resp?.text === "string"
          ? resp.text
          : "";
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return;
  if (trimmed.length <= MIN_JSON_CHARS) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Likely truncated JSON — exactly the class the source rewrite exists for.
    if (trimmed.length >= TRUNCATION_LEARN_CHARS) learn(last);
    return;
  }
  if (typeof parsed !== "object" || parsed === null) return;

  learn(last);
  if (NO_CONVERT_COMMANDS.has(firstWord)) return;

  const toon = spawnSync("toon", [], {
    input: trimmed,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (toon.status !== 0 || !toon.stdout || toon.stdout.length >= trimmed.length)
    return;
  const pct = Math.round((1 - toon.stdout.length / trimmed.length) * 100);
  // Mirror the shape we received: object responses get stdout swapped in
  // place; string/text responses are replaced wholesale.
  const updated =
    typeof resp === "object" && resp !== null && typeof resp.stdout === "string"
      ? { ...resp, stdout: toon.stdout }
      : toon.stdout;
  emit({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: updated,
      additionalContext: `Output was auto-converted from JSON to TOON (${pct}% smaller). This command emits JSON; once confirmed twice it will be piped through toon at the source automatically.`,
    },
  });
}

main();
