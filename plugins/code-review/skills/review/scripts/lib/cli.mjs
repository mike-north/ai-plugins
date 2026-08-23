// Shared CLI plumbing for every script in this plugin (capture-core and
// posting/rendering alike): argument parsing, stdin reading, and the one
// shared exit-code contract, so no two scripts can independently invent a
// conflicting meaning for the same code.
//
// Exit codes: 0 ok, 1 unexpected, 2 usage, 3 input validation failed, 4 drift
// (head moved / partition violation / overlap without --amend), 5 partial
// post (post-review.mjs: some review threads landed, some did not), 6 a
// foreign PENDING review already exists on the PR (post-review.mjs; never
// deleted or touched).

import * as fs from "node:fs";
import { pathToFileURL } from "node:url";

export const EXIT = { OK: 0, UNEXPECTED: 1, USAGE: 2, INVALID: 3, DRIFT: 4, PARTIAL: 5, FOREIGN_PENDING: 6 };

export class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
  }
}
export class UsageError extends CliError {
  constructor(message) {
    super(message, EXIT.USAGE);
  }
}
export class ValidationError extends CliError {
  constructor(message) {
    super(message, EXIT.INVALID);
  }
}
export class DriftError extends CliError {
  constructor(message) {
    super(message, EXIT.DRIFT);
  }
}

/** Minimal `--flag value` / `--flag` (boolean) / `-x value` argv parser.
 * Short flags (`-o`) parse identically to long ones — several CLI contracts
 * document `-o <file>` and this parser used to drop them silently. */
export function parseArgs(argv) {
  const args = {};
  const isFlag = (s) => typeof s === "string" && s.length > 1 && s.startsWith("-") && !/^-\d/.test(s);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!isFlag(a)) continue;
    const key = a.startsWith("--") ? a.slice(2) : a.slice(1);
    const next = argv[i + 1];
    if (next == null || isFlag(next)) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

/** Read all of stdin synchronously; returns "" if stdin is not readable (e.g. a TTY). */
export function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Run a synchronous CLI entrypoint, mapping thrown `CliError`s (and anything
 * else) to the shared exit-code contract and a stderr message.
 */
export function runCli(fn) {
  try {
    fn();
  } catch (e) {
    const code = e instanceof CliError ? e.exitCode : EXIT.UNEXPECTED;
    process.stderr.write(`error: ${e.message}\n`);
    process.exitCode = code;
  }
}

/**
 * True when `moduleUrl` (a script's `import.meta.url`) is the module Node was
 * asked to run directly — i.e. the script should execute its CLI entry.
 *
 * A hand-built `file://${process.argv[1]}` comparison breaks whenever the
 * install path needs URL encoding (`import.meta.url` percent-encodes a space
 * as %20 — e.g. under "…/Application Support/…"), and a plain
 * `pathToFileURL(process.argv[1])` comparison still breaks when argv[1]
 * reaches the script through a symlink (macOS `/tmp` → `/private/tmp`),
 * because Node resolves the main ES module to its real path before loading
 * it. Either failure mode makes the script exit 0 with no output — a silent
 * no-op that looks like success. So: realpath argv[1], then compare
 * canonically encoded file URLs.
 */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return moduleUrl === pathToFileURL(fs.realpathSync(entry)).href;
  } catch {
    return false;
  }
}
