/**
 * `toolsmith lint` — the proposal gate (docs/toolsmith/cli-surface.md §Verbs):
 * cheap, non-privileged, requires no presence, so the authoring agent can
 * iterate a staged draft to green without ever spending a human tap to
 * discover a lint error. `toolsmith approve` runs the IDENTICAL gate,
 * fail-closed, as a precondition — never a second, looser check.
 *
 * Scope honesty: the full forge rule pack
 * (docs/toolsmith/lint-rule-concepts.md) is specified against eslint-sh,
 * which does not exist yet — those rules are concepts pending that project.
 * This gate runs what is mechanizable today: syntax (`bash -n`), shellcheck
 * where installed, and deterministic heuristics for the conventions the
 * design docs already commit to (no interactive prompts, no secrets via
 * flags/env — docs/toolsmith/design-patterns.md). Each pending forge-pack
 * rule is reported as `pending` so the output never implies coverage that
 * isn't there.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export interface LintFinding {
  rule: string;
  message: string;
}

export interface LintResult {
  errors: LintFinding[];
  warnings: LintFinding[];
  /** Forge-pack rules that could not run (pending eslint-sh). */
  pending: string[];
  /** Checks skipped on this machine (e.g. shellcheck not installed). */
  skipped: LintFinding[];
}

/** Forge rule pack concepts (docs/toolsmith/lint-rule-concepts.md) that are
 * pending eslint-sh and therefore cannot run yet. Reported honestly. */
const PENDING_FORGE_RULES = [
  "contract-header-present",
  "require-declares-usage",
  "side-effect-honesty",
  "timeout-discipline",
  "exit-code-map-integrity",
  "runtime-pin-and-prelude",
  "docs-drift",
  "confirm-for-severe",
  "rationale-for-authority",
  "composition-declares-inputs",
  "no-inline-config",
] as const;

let _bashAvailable: boolean | undefined;
function bashAvailable(): boolean {
  if (_bashAvailable === undefined) {
    try {
      _bashAvailable = spawnSync("bash", ["-c", "true"], { stdio: "ignore" }).status === 0;
    } catch {
      _bashAvailable = false;
    }
  }
  return _bashAvailable;
}

let _shellcheckAvailable: boolean | undefined;
function shellcheckAvailable(): boolean {
  if (_shellcheckAvailable === undefined) {
    try {
      _shellcheckAvailable = spawnSync("shellcheck", ["--version"], { stdio: "ignore" }).status === 0;
    } catch {
      _shellcheckAvailable = false;
    }
  }
  return _shellcheckAvailable;
}

/**
 * Run the proposal gate over a draft's bytes. `displayPath` is used only in
 * messages. Deterministic given the same bytes and the same installed
 * toolchain; machine-dependent checks that cannot run are reported in
 * `skipped`, never silently omitted.
 */
export function lintGate(bytes: Buffer, displayPath: string): LintResult {
  const errors: LintFinding[] = [];
  const warnings: LintFinding[] = [];
  const skipped: LintFinding[] = [];

  const text = bytes.toString("utf8");

  if (bytes.length === 0) {
    errors.push({ rule: "non-empty", message: `${displayPath} is empty — there is nothing to review or promote.` });
    return { errors, warnings, pending: [...PENDING_FORGE_RULES], skipped };
  }

  if (bytes.includes(0)) {
    errors.push({
      rule: "text-script",
      message: `${displayPath} contains NUL bytes — forged tools are text shell scripts, not binaries.`,
    });
    return { errors, warnings, pending: [...PENDING_FORGE_RULES], skipped };
  }

  // Shebang: forged tools are bash (design-patterns.md §Language choice).
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith("#!")) {
    warnings.push({
      rule: "shebang",
      message: `missing shebang — forged tools should start with "#!/bin/bash" (or "#!/usr/bin/env bash").`,
    });
  } else if (!/\b(bash|sh)\b/.test(firstLine)) {
    warnings.push({
      rule: "shebang",
      message: `shebang "${firstLine}" is not a bash/sh interpreter — forged tools are shell scripts.`,
    });
  }

  // Syntax: `bash -n` parses without executing. A draft that cannot parse can
  // never be promoted (errors block); bash being unavailable is a skip.
  if (bashAvailable()) {
    const r = spawnSync("bash", ["-n"], { input: bytes, stdio: ["pipe", "ignore", "pipe"] });
    if (r.status !== 0) {
      const stderr = r.stderr ? r.stderr.toString().trim().replace(/^bash: line /gm, "line ") : "";
      errors.push({
        rule: "bash-syntax",
        message: `bash -n rejected the script${stderr ? `: ${stderr}` : ""}.`,
      });
    }
  } else {
    skipped.push({ rule: "bash-syntax", message: "bash is not available on this machine; syntax check skipped." });
  }

  // shellcheck: error-severity findings block (same gate in lint and
  // approve); the full report at default severity is the agent's iteration
  // loop, surfaced as warnings. Absence is a skip, not a failure.
  if (shellcheckAvailable()) {
    const err = spawnSync("shellcheck", ["--severity=error", "--shell=bash", "--format=gcc", "-"], {
      input: bytes,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (err.status !== 0) {
      const lines = (err.stdout ? err.stdout.toString() : "").trim().split("\n").filter(Boolean);
      for (const line of lines) {
        errors.push({ rule: "shellcheck", message: line.replace(/^-:/, "") });
      }
      if (lines.length === 0) {
        errors.push({ rule: "shellcheck", message: `shellcheck --severity=error failed (exit ${String(err.status)}).` });
      }
    }
    const warn = spawnSync("shellcheck", ["--severity=warning", "--shell=bash", "--format=gcc", "-"], {
      input: bytes,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (warn.status !== 0) {
      const lines = (warn.stdout ? warn.stdout.toString() : "").trim().split("\n").filter(Boolean);
      const errorSet = new Set(errors.map((e) => e.message));
      for (const line of lines) {
        const msg = line.replace(/^-:/, "");
        if (!errorSet.has(msg)) warnings.push({ rule: "shellcheck", message: msg });
      }
    }
  } else {
    skipped.push({
      rule: "shellcheck",
      message: "shellcheck is not installed; static analysis skipped (brew install shellcheck).",
    });
  }

  // Interactivity, entirely rejected (design-patterns.md §Rejections): a
  // prompt would deadlock an agent.
  if (/^\s*read\s+(-[a-zA-Z]*p|.*\s-p\s)/m.test(text) || /\bselect\s+\w+\s+in\b/.test(text)) {
    warnings.push({
      rule: "no-interactivity",
      message: "interactive prompt detected (`read -p` / `select`) — forged tools must fail fast instead of prompting.",
    });
  }

  // No secrets via flags or environment variables (design-patterns.md):
  // command lines land in transcripts and the post-hook history log.
  if (/--(token|password|secret|api-key)[= ]/i.test(text)) {
    warnings.push({
      rule: "no-secret-flags",
      message: "a --token/--password/--secret style flag appears — secrets travel via files or stdin, never flags.",
    });
  }

  return { errors, warnings, pending: [...PENDING_FORGE_RULES], skipped };
}

/** Render a lint result as deterministic, relay-friendly text. */
export function renderLintReport(result: LintResult): string {
  const lines: string[] = [];
  for (const e of result.errors) lines.push(`error   ${e.rule}: ${e.message}`);
  for (const w of result.warnings) lines.push(`warning ${w.rule}: ${w.message}`);
  for (const s of result.skipped) lines.push(`skipped ${s.rule}: ${s.message}`);
  return lines.length ? lines.join("\n") + "\n" : "";
}

export interface LintOptions {
  file: string;
}

/**
 * `toolsmith lint <file>` — lint one draft file (typically a staging draft).
 * Exit 0 when the gate passes (warnings allowed), 1 on errors or an unreadable
 * file. Warnings are advisory; the identical error set is what `approve`
 * enforces fail-closed.
 */
export function runLint({ file }: LintOptions): number {
  if (!existsSync(file)) {
    process.stderr.write(`Error: ${file} does not exist.\n`);
    return 1;
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (err) {
    process.stderr.write(`Error: could not read ${file}: ${(err as Error).message}\n`);
    return 1;
  }
  const result = lintGate(bytes, file);
  const report = renderLintReport(result);
  if (report) process.stdout.write(report);
  process.stdout.write(
    `pending (forge rule pack, awaiting eslint-sh): ${result.pending.join(", ")}\n` +
      (result.errors.length
        ? `FAIL: ${String(result.errors.length)} error(s) — fix in staging and re-run.\n`
        : `PASS${result.warnings.length ? ` with ${String(result.warnings.length)} warning(s)` : ""}.\n`),
  );
  return result.errors.length ? 1 : 0;
}
