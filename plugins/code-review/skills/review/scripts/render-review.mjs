#!/usr/bin/env node
// render-review — deterministically render a MERGED SARIF log (the output of
// merge-findings.mjs) into a human/GitHub-facing report: a verdict line,
// counts, Critical/Important/Suggestions sections, a Design-level section
// (scope file|pr findings), and a "Not posted inline" demotion appendix.
//
// Usage:
//   node render-review.mjs --sarif <merged.sarif.json> [--format terminal|markdown|github-body]
//
// The `github-body` renderer is also exported as a function
// (`renderGithubBody`) so post-review.mjs can reuse the exact same rendering
// for the PENDING review body it posts — one implementation, two callers.
//
// Exit codes: 0 ok, 2 usage.

import * as fs from "node:fs";
import { EXIT, UsageError, parseArgs, runCli } from "./lib/cli.mjs";
import { readHeadBlob } from "./lib/snapshot.mjs";

export const VALID_FORMATS = new Set(["terminal", "markdown", "github-body"]);

const LEVEL_LABEL = { error: "CRITICAL", warning: "IMPORTANT", note: "SUGGESTION" };

// ---------------------------------------------------------------------------
// Pure extraction / derivation
// ---------------------------------------------------------------------------

/** Parse `https://<host>/<owner>/<repo>` (as written by review-init's repositoryUri). */
export function parseRepositoryUri(uri) {
  const m = typeof uri === "string" ? /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/?$/.exec(uri) : null;
  if (!m) return null;
  return { host: m[1], owner: m[2], repo: m[3] };
}

/** "Request changes" if any error-level result, else "Comment only" if any warning, else "Looks good". */
export function deriveVerdict(results) {
  if (results.some((r) => r.level === "error")) return "Request changes";
  if (results.some((r) => r.level === "warning")) return "Comment only";
  return "Looks good";
}

/** @returns {{critical:number, important:number, suggestions:number, designLevel:number}} */
export function computeCounts(results) {
  const counts = { critical: 0, important: 0, suggestions: 0, designLevel: 0 };
  for (const r of results) {
    const scope = r.properties?.scope ?? "line";
    if (scope !== "line") {
      counts.designLevel++;
      continue;
    }
    if (r.level === "error") counts.critical++;
    else if (r.level === "warning") counts.important++;
    else counts.suggestions++;
  }
  return counts;
}

/** `path:start` (single line) or `path:start-end` (range); `path` for scope "file"; `(pr-wide)` for scope "pr". */
export function formatLocation(result) {
  const scope = result.properties?.scope ?? "line";
  const loc = result.locations?.[0]?.physicalLocation;
  if (scope === "pr" || !loc) return "(pr-wide)";
  const uri = loc.artifactLocation?.uri ?? "(unknown file)";
  if (scope === "file" || !loc.region) return uri;
  const { startLine, endLine } = loc.region;
  return startLine === endLine ? `${uri}:${startLine}` : `${uri}:${startLine}-${endLine}`;
}

/** `_(ruleId, confidence[, corroborated by a, b])_` — the italic attribution suffix after a message. */
export function formatAttribution(result) {
  const parts = [result.ruleId, result.properties?.confidence].filter(Boolean);
  const corroboratedBy = result.properties?.corroboratedBy;
  let text = `_(${parts.join(", ")}`;
  if (Array.isArray(corroboratedBy) && corroboratedBy.length > 0) {
    text += `, corroborated by ${corroboratedBy.join(", ")}`;
  }
  return text + ")_";
}

// ---------------------------------------------------------------------------
// Diff-block reconstruction (old side from `git show HEAD:<uri>`, new side
// from the fix's insertedContent) — used for both render-review's per-finding
// blocks and, indirectly, post-review's oversized/whole-file-fix fallback.
// ---------------------------------------------------------------------------

/**
 * Reconstruct a plain ` ```diff ` block for one SARIF `fixes[0]`. Replacement
 * changes render their HEAD-line deletions then their inserted-content
 * additions, in file order; a change with no `replacements` (an add/rename/
 * binary artifactChange) renders as a one-line marker instead of a diff body,
 * since there is no line-level content to reconstruct.
 *
 * @param {object} fix               a SARIF `fixes[0]` entry
 * @param {(file: string) => string[]} getHeadLines
 * @returns {string} fenced ` ```diff ` block (no trailing newline)
 */
/** Longest run of consecutive backticks anywhere in `text`. */
function longestBacktickRun(text) {
  const matches = typeof text === "string" ? text.match(/`+/g) : null;
  return (matches ?? []).reduce((max, m) => Math.max(max, m.length), 0);
}

export function reconstructDiffBlock(fix, getHeadLines) {
  const body = [];
  for (const change of fix.artifactChanges ?? []) {
    const uri = change.artifactLocation?.uri ?? "(unknown file)";
    if (!Array.isArray(change.replacements) || change.replacements.length === 0) {
      const kind = change.properties?.kind ?? "change";
      body.push(`# ${uri}: whole-file ${kind}, not shown`);
      continue;
    }
    const headLines = getHeadLines(uri);
    for (const r of change.replacements) {
      for (let i = r.deletedRegion.startLine; i <= r.deletedRegion.endLine; i++) {
        body.push(`-${headLines[i - 1] ?? ""}`);
      }
      const inserted = r.insertedContent?.text ?? "";
      if (inserted !== "") {
        for (const l of inserted.split("\n")) body.push(`+${l}`);
      }
    }
  }
  // The fence must be longer than the longest backtick run in the body
  // (matching buildSuggestionFence's logic in post-review.mjs) — otherwise
  // content that itself contains a fenced code block (e.g. a markdown file
  // with an embedded ```js example) would break out of a fixed ```diff fence.
  const fenceLen = Math.max(longestBacktickRun(body.join("\n")) + 1, 3);
  const fence = "`".repeat(fenceLen);
  return [`${fence}diff`, ...body, fence].join("\n");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderFindingBullet(result, { getHeadLines }) {
  const out = [`- **\`${formatLocation(result)}\`** — ${result.message?.text ?? ""} ${formatAttribution(result)}`];
  const fix = result.fixes?.[0];
  if (fix && getHeadLines) {
    out.push("");
    out.push(reconstructDiffBlock(fix, getHeadLines));
  }
  return out.join("\n");
}

/**
 * Render a merged SARIF log into a full report.
 *
 * @param {object} log                a merged SARIF log (merge-findings.mjs output)
 * @param {object} [opts]
 * @param {"terminal"|"markdown"|"github-body"} [opts.format]
 * @param {string} [opts.worktree]    enables ` ```diff ` reconstruction for fixes when given
 * @returns {string}
 */
export function renderReview(log, { format = "markdown", worktree } = {}) {
  if (!VALID_FORMATS.has(format)) {
    throw new Error(`format must be one of terminal|markdown|github-body (got "${format}")`);
  }
  const run = log.runs?.[0] ?? {};
  const results = run.results ?? [];
  const repoInfo = parseRepositoryUri(run.versionControlProvenance?.[0]?.repositoryUri);
  const revisionId = run.versionControlProvenance?.[0]?.revisionId;
  const prNumber = run.properties?.prNumber;
  const reviewers = run.properties?.reviewers ?? [];
  const verdict = deriveVerdict(results);
  const counts = computeCounts(results);

  const getHeadLines = worktree ? (file) => readHeadBlob(worktree, file).lines : null;

  const lines = [];
  if (format === "terminal") {
    lines.push("# Code Review", "");
  }
  const repoLabel = repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : "(unknown repo)";
  const prLabel = prNumber != null ? `#${prNumber}` : "";
  const shaLabel = revisionId ? `@ ${revisionId.slice(0, 7)} ` : "";
  lines.push(`## Review: ${repoLabel}${prLabel} ${shaLabel}— ${verdict}`);
  lines.push("");
  lines.push(
    `${results.length} finding(s) from ${reviewers.length} reviewer(s): ${counts.critical} critical, ` +
      `${counts.important} important, ${counts.suggestions} suggestion(s), ${counts.designLevel} design-level`,
  );
  lines.push("");

  const inlineEligible = (r) => (r.properties?.scope ?? "line") === "line" && r.properties?.demoted == null;
  const isDemoted = (r) => r.properties?.demoted != null;

  for (const [level, label] of [
    ["error", "Critical"],
    ["warning", "Important"],
    ["note", "Suggestions"],
  ]) {
    const group = results.filter((r) => inlineEligible(r) && r.level === level);
    if (group.length === 0) continue;
    lines.push(`### ${label} (${group.length})`);
    lines.push("");
    for (const r of group) lines.push(renderFindingBullet(r, { getHeadLines }));
    lines.push("");
  }

  const designLevel = results.filter((r) => (r.properties?.scope ?? "line") !== "line" && !isDemoted(r));
  if (designLevel.length > 0) {
    lines.push(`### Design-level (${designLevel.length})`);
    lines.push("");
    for (const r of designLevel) {
      lines.push(
        `- **\`${formatLocation(r)}\`** — ${r.message?.text ?? ""} _(${LEVEL_LABEL[r.level] ?? r.level})_ ${formatAttribution(r)}`,
      );
    }
    lines.push("");
  }

  const demoted = results.filter(isDemoted);
  if (demoted.length > 0) {
    lines.push(`### Not posted inline (${demoted.length})`);
    lines.push("");
    for (const r of demoted) {
      lines.push(`- **\`${formatLocation(r)}\`** — ${r.message?.text ?? ""} (reason: ${r.properties.demoted})`);
    }
    lines.push("");
  }

  if (results.length === 0) {
    lines.push("No findings.");
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** Convenience wrapper: the exact renderer post-review.mjs uses for the PENDING review body. */
export function renderGithubBody(log, { worktree } = {}) {
  return renderReview(log, { format: "github-body", worktree });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sarifPath = args.sarif;
  if (!sarifPath || sarifPath === true) throw new UsageError("--sarif <merged.sarif.json> is required");
  const format = typeof args.format === "string" ? args.format : "markdown";
  if (!VALID_FORMATS.has(format)) {
    throw new UsageError(`--format must be one of terminal|markdown|github-body (got "${args.format}")`);
  }
  const log = JSON.parse(fs.readFileSync(sarifPath, "utf8"));
  const worktree = resolveWorktreeForCli(log, typeof args["work-area"] === "string" ? args["work-area"] : undefined);
  process.stdout.write(renderReview(log, { format, worktree }));
}

/**
 * Resolve the worktree: an explicit `--work-area` override always wins (via
 * its state.json); otherwise prefer `run.properties.worktree` directly
 * (merge-findings.mjs writes this), falling back to `run.properties.workArea`'s
 * state.json for older merged SARIFs that predate that direct property.
 */
function resolveWorktreeForCli(log, workAreaOverride) {
  if (!workAreaOverride) {
    const direct = log.runs?.[0]?.properties?.worktree;
    if (direct) return direct;
  }
  const workArea = workAreaOverride ?? log.runs?.[0]?.properties?.workArea;
  if (!workArea) return undefined;
  try {
    const state = JSON.parse(fs.readFileSync(`${workArea}/state.json`, "utf8"));
    return state.worktree;
  } catch {
    return undefined;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(main);
  process.exit(process.exitCode ?? EXIT.OK);
}
