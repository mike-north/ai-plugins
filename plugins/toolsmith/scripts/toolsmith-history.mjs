#!/usr/bin/env node
/**
 * toolsmith-history: the sanctioned reader for .claude/toolsmith/history.jsonl.
 *
 * The history log stores Bash commands verbatim, so it can contain inline
 * secrets (tokens pasted into a command, Authorization headers, URL basic
 * auth). Agents must never read the raw file — the PreToolUse hook denies
 * Read on it and steers here. This reader redacts secret-like values BEFORE
 * anything is printed or matched, so mining recurrence never exposes a
 * credential: --grep runs against the already-redacted text, which also
 * prevents using match/no-match as an oracle to reconstruct a secret.
 *
 * Usage:
 *   toolsmith-history [--grep <regex>] [--limit <N>] [--project <dir>] [--help]
 *
 * Output: history JSONL lines ({ts, cwd, command, exitCode}) with secret-like
 * spans in `command` replaced by [REDACTED]. Malformed lines are redacted as
 * raw text and passed through. --limit keeps the most recent N lines.
 *
 * Redaction patterns are a curated, high-confidence subset informed by
 * https://github.com/mazen160/secrets-patterns-db (provider token formats)
 * plus structural patterns (env assignments, auth headers, URL credentials).
 * Redaction is best-effort defense in depth, not a guarantee — the log is
 * still gitignored and treated as sensitive.
 *
 * @see ../skills/toolsmith/references/registry-schema.md (history.jsonl schema)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HELP = `toolsmith-history — read history.jsonl with secret-like values redacted

Usage:
  toolsmith-history [--grep <regex>] [--limit <N>] [--project <dir>]

Options:
  --grep <regex>    Only print lines whose REDACTED command matches <regex> (JS regex, case-insensitive)
  --limit <N>       Only the most recent N lines
  --project <dir>   Project root (default: CLAUDE_PROJECT_DIR / CURSOR_PROJECT_DIR / cwd)
  --help            Show this help
`;

// Provider token formats (informed by secrets-patterns-db) + structural
// catches. Order matters: structural patterns that capture a keep-prefix
// (group 1) come last so provider tokens inside them are already gone.
const SECRET_PATTERNS = [
  // PEM private key blocks (multi-line content collapses into one command string)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  // GitHub tokens (classic + fine-grained)
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  // AWS access key ids
  /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  // Slack tokens
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // OpenAI / Anthropic / Stripe style keys
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[0-9a-zA-Z]{10,}\b/g,
  // JWTs
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g,
  // URL basic-auth credentials — keep scheme and user, drop the password
  /(:\/\/[^/\s:@'"]+:)[^@\s'"]+(?=@)/g,
  // Authorization/api-key headers — keep the header name and scheme
  /((?:authorization|x-api-key|api-key)["']?\s*[:=]\s*["']?(?:bearer|basic|token)?\s*)[A-Za-z0-9+/._=-]{8,}/gi,
  // KEY=value env-style assignments with a secret-suggesting name
  /(\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIALS?)[A-Z0-9_]*\s*=\s*)["']?[^\s"']{4,}["']?/gi,
];

function redact(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, keep) => (typeof keep === 'string' ? keep + '[REDACTED]' : '[REDACTED]'));
  }
  return out;
}

function projectRoot(flagValue) {
  return flagValue || process.env.CLAUDE_PROJECT_DIR || process.env.CURSOR_PROJECT_DIR || process.cwd();
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const flag = (name) => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };

  let grep = null;
  const grepRaw = flag('--grep');
  if (grepRaw !== null) {
    try {
      grep = new RegExp(grepRaw, 'i');
    } catch (e) {
      process.stderr.write(`Error: invalid --grep regex: ${e.message}\n`);
      return 1;
    }
  }
  const limitRaw = flag('--limit');
  const limit = limitRaw !== null ? Number.parseInt(limitRaw, 10) : NaN;
  if (limitRaw !== null && (!Number.isInteger(limit) || limit < 1)) {
    process.stderr.write('Error: --limit must be a positive integer.\n');
    return 1;
  }

  const historyPath = join(projectRoot(flag('--project')), '.claude', 'toolsmith', 'history.jsonl');
  let raw;
  try {
    raw = readFileSync(historyPath, 'utf8');
  } catch {
    process.stderr.write(`No history at ${historyPath}\n`);
    return 1;
  }

  let lines = raw.split('\n').filter((l) => l.trim());
  if (Number.isInteger(limit)) lines = lines.slice(-limit);

  for (const line of lines) {
    let rendered;
    try {
      const entry = JSON.parse(line);
      entry.command = redact(entry.command);
      rendered = JSON.stringify(entry);
    } catch {
      rendered = redact(line); // malformed line: redact as raw text
    }
    if (grep && !grep.test(rendered)) continue;
    process.stdout.write(rendered + '\n');
  }
  return 0;
}

process.exit(main());
