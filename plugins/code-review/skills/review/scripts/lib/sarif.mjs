// SARIF 2.1.0 helpers for the code-review plugin.
//
// This module has two layers:
//   1. The original minimal-log helpers (`emptyLog`, `buildResult`, `loadLog`,
//      `writeLog`, `addResult`, `normalizeLevel`) — unchanged, validate a
//      finding's region against a *live* file on disk. Kept for backward
//      compatibility with existing callers/tests.
//   2. The richer per-reviewer capture-core profile (`emptyReviewerLog`,
//      `buildFindingResult`, `attachFix`, `fingerprintText`) used by
//      review-init/record-finding/merge-findings — validates a finding's
//      region against the HEAD blob (not the live worktree file), and adds
//      provenance, fingerprints, and structured properties.
//
// Zero dependencies — runs under bare `node`.
//
// @see https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
// @see https://json.schemastore.org/sarif-2.1.0.json

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
export const SARIF_VERSION = "2.1.0";

/** Human severity vocabulary → SARIF level. */
export const SEVERITY_TO_LEVEL = {
  critical: "error",
  important: "warning",
  suggestion: "note",
};

export const VALID_LEVELS = new Set(["error", "warning", "note"]);
export const VALID_SCOPES = new Set(["line", "file", "pr"]);
export const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

/**
 * Normalize a caller-supplied `level` or `severity` to a SARIF level.
 * Accepts SARIF levels (error/warning/note) or the human vocabulary
 * (critical/important/suggestion). Throws on anything else.
 */
export function normalizeLevel({ level, severity }) {
  if (level != null) {
    const l = String(level).toLowerCase();
    if (!VALID_LEVELS.has(l)) {
      throw new Error(`invalid level "${level}" (expected error|warning|note)`);
    }
    return l;
  }
  if (severity != null) {
    const s = String(severity).toLowerCase();
    if (!(s in SEVERITY_TO_LEVEL)) {
      throw new Error(
        `invalid severity "${severity}" (expected critical|important|suggestion)`,
      );
    }
    return SEVERITY_TO_LEVEL[s];
  }
  throw new Error("a finding requires either `level` or `severity`");
}

/** Build an empty, valid SARIF log for one lens (legacy shape — no provenance). */
export function emptyLog(lensId) {
  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: { driver: { name: `code-review:${lensId}`, rules: [] } },
        results: [],
      },
    ],
  };
}

/** Count the lines in a file on disk (for region bounds checks). */
function countLines(absPath) {
  const text = fs.readFileSync(absPath, "utf8");
  if (text === "") return 0;
  // A trailing newline does not introduce an extra line.
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

/**
 * Validate and normalize a region {startLine, endLine?} against a known line count.
 * Returns a normalized region or throws with a precise message.
 */
function validateRegion(region, lineCount, label) {
  const startLine = region.startLine;
  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new Error(`${label}: startLine must be an integer >= 1 (got ${startLine})`);
  }
  if (startLine > lineCount) {
    throw new Error(`${label}: startLine ${startLine} is past end of file (${lineCount} lines)`);
  }
  let endLine = region.endLine;
  if (endLine == null) {
    endLine = startLine;
  } else {
    if (!Number.isInteger(endLine) || endLine < 1) {
      throw new Error(`${label}: endLine must be an integer >= 1 (got ${endLine})`);
    }
    if (endLine < startLine) {
      throw new Error(`${label}: endLine ${endLine} < startLine ${startLine}`);
    }
    if (endLine > lineCount) {
      throw new Error(`${label}: endLine ${endLine} is past end of file (${lineCount} lines)`);
    }
  }
  return { startLine, endLine };
}

/**
 * Validate a finding and convert it to a SARIF `result` object. Region is
 * checked against the *live* file on disk under `root`.
 *
 * @param {object} finding
 * @param {string} finding.ruleId        short rule/category id (required)
 * @param {string} [finding.level]       error|warning|note
 * @param {string} [finding.severity]    critical|important|suggestion (mapped to level)
 * @param {string} finding.message       human-readable message (required)
 * @param {string} [finding.file]        path relative to `root`; omit for a general finding
 * @param {number} [finding.startLine]   1-based; omit for a file-level finding
 * @param {number} [finding.endLine]     defaults to startLine
 * @param {object} [finding.fix]         { replacement, startLine?, endLine? } suggested code change
 * @param {string} root                  directory the `file` path is resolved against
 * @returns {object} a SARIF result
 */
export function buildResult(finding, root) {
  if (!finding || typeof finding !== "object") {
    throw new Error("finding must be an object");
  }
  const ruleId = finding.ruleId;
  if (typeof ruleId !== "string" || ruleId.trim() === "") {
    throw new Error("finding.ruleId is required (non-empty string)");
  }
  const message = finding.message;
  if (typeof message !== "string" || message.trim() === "") {
    throw new Error("finding.message is required (non-empty string)");
  }
  const level = normalizeLevel(finding);

  const result = { ruleId, level, message: { text: message } };

  // Location (optional). A general finding has no `file`.
  if (finding.file != null) {
    if (typeof finding.file !== "string" || finding.file.trim() === "") {
      throw new Error("finding.file, if present, must be a non-empty string");
    }
    const abs = path.resolve(root, finding.file);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(`finding.file does not exist under root: ${finding.file}`);
    }
    const physicalLocation = { artifactLocation: { uri: finding.file } };
    if (finding.startLine != null) {
      physicalLocation.region = validateRegion(
        { startLine: finding.startLine, endLine: finding.endLine },
        countLines(abs),
        "location",
      );
    }
    result.locations = [{ physicalLocation }];
  } else if (finding.startLine != null) {
    throw new Error("finding.startLine given without finding.file");
  }

  // Optional suggested fix → SARIF fixes[].artifactChanges[].replacements[].
  if (finding.fix != null) {
    const fix = finding.fix;
    if (finding.file == null) {
      throw new Error("finding.fix requires finding.file");
    }
    if (typeof fix.replacement !== "string") {
      throw new Error("finding.fix.replacement must be a string");
    }
    const abs = path.resolve(root, finding.file);
    const region = validateRegion(
      { startLine: fix.startLine ?? finding.startLine, endLine: fix.endLine ?? finding.endLine },
      countLines(abs),
      "fix",
    );
    result.fixes = [
      {
        description: { text: fix.description ?? "Suggested change" },
        artifactChanges: [
          {
            artifactLocation: { uri: finding.file },
            replacements: [
              {
                deletedRegion: region,
                insertedContent: { text: fix.replacement },
              },
            ],
          },
        ],
      },
    ];
  }

  return result;
}

/** Read a SARIF log from disk, or return a fresh empty one for the lens. */
export function loadLog(filePath, lensId) {
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  return emptyLog(lensId);
}

/** Write a SARIF log to disk (pretty-printed, trailing newline). */
/**
 * Write to `finalPath` via a temp file + atomic rename, so a concurrent
 * reader (e.g. merge-findings.mjs) always sees either the fully-old or
 * fully-new content, never a torn/partial write. Per-process (not per-call)
 * temp path — callers are expected to serialize their own writes to a given
 * file (record-finding.mjs does, via lib/snapshot.mjs's withLock).
 */
function writeFileAtomic(finalPath, text) {
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, text);
  fs.renameSync(tmpPath, finalPath);
}

export function writeLog(filePath, log) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileAtomic(filePath, JSON.stringify(log, null, 2) + "\n");
}

/** Append a result to the first run of a log (mutates and returns it). */
export function addResult(log, result) {
  log.runs[0].results.push(result);
  return log;
}

// ---------------------------------------------------------------------------
// Capture-core profile: per-reviewer logs with provenance, fingerprints, and
// structured properties. Region validation here is always against a
// caller-supplied line count (the HEAD blob), never the live worktree file.
// ---------------------------------------------------------------------------

export const SRCROOT = "SRCROOT";

/**
 * Build an empty SARIF log for one reviewer, carrying run-level provenance.
 *
 * @param {object} ctx
 * @param {string} ctx.reviewer       reviewer/lens id
 * @param {string} ctx.worktreeRoot   absolute path to the worktree root
 * @param {string} ctx.headSha        HEAD commit sha the review is based on
 * @param {string} ctx.baselineTree   HEAD^{tree} oid
 * @param {string} [ctx.branch]
 * @param {string} [ctx.repositoryUri]
 * @param {string} [ctx.workArea]
 * @param {number} [ctx.prNumber]
 */
export function emptyReviewerLog(ctx) {
  if (!ctx || typeof ctx !== "object") throw new Error("context is required");
  const { reviewer, worktreeRoot, headSha, baselineTree, branch, repositoryUri, workArea, prNumber } = ctx;
  if (!reviewer) throw new Error("ctx.reviewer is required");
  if (!worktreeRoot) throw new Error("ctx.worktreeRoot is required");
  if (!headSha) throw new Error("ctx.headSha is required");
  if (!baselineTree) throw new Error("ctx.baselineTree is required");

  const run = {
    tool: { driver: { name: `code-review:${reviewer}`, rules: [] } },
    originalUriBaseIds: {
      [SRCROOT]: { uri: pathToFileURL(path.resolve(worktreeRoot) + path.sep).href },
    },
    properties: {
      ...(workArea != null ? { workArea } : {}),
      ...(prNumber != null ? { prNumber } : {}),
      baselineTree,
    },
    results: [],
  };
  if (repositoryUri) {
    run.versionControlProvenance = [{ repositoryUri, revisionId: headSha, branch }];
  }
  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [run],
  };
}

/**
 * SHA-256 fingerprint per the capture-core profile:
 *   scope "line": sha256(ruleId + NUL + uri + NUL + trimmed HEAD region-start-line text)
 *   scope "file"/"pr": sha256(ruleId + NUL + (uri||"") + NUL + lowercased, whitespace-collapsed message)
 */
export function fingerprintText({ ruleId, scope, uri, headLineText, message }) {
  let raw;
  if (scope === "line") {
    if (headLineText == null) throw new Error("fingerprintText: headLineText is required for scope 'line'");
    raw = `${ruleId}\0${uri}\0${headLineText.trim()}`;
  } else {
    const normalizedMessage = String(message).toLowerCase().replace(/\s+/g, " ").trim();
    raw = `${ruleId}\0${uri ?? ""}\0${normalizedMessage}`;
  }
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Validate a finding against the capture-core profile and build its SARIF
 * `result`. Region (when scope is "line") is validated against
 * `ctx.headLines` — the file's content *at HEAD*, not the live worktree file.
 *
 * @param {object} finding
 * @param {string} finding.ruleId
 * @param {string} [finding.severity]  critical|important|suggestion
 * @param {string} [finding.level]     error|warning|note (alternative to severity)
 * @param {string} finding.message
 * @param {string} [finding.file]      required unless scope is "pr"
 * @param {number} [finding.startLine] required when scope is "line"
 * @param {number} [finding.endLine]   defaults to startLine
 * @param {string} [finding.scope]     "line" (default) | "file" | "pr"
 * @param {string} finding.confidence  high|medium|low
 * @param {object} ctx
 * @param {string} ctx.findingId
 * @param {string} ctx.reviewer
 * @param {string[]} [ctx.headLines]   HEAD blob lines for finding.file; required unless scope "pr"
 * @returns {object} SARIF result (no `fixes` — attach separately via attachFix)
 */
export function buildFindingResult(finding, ctx) {
  if (!finding || typeof finding !== "object") throw new Error("finding must be an object");
  if (!ctx || typeof ctx !== "object") throw new Error("context is required");
  const { findingId, reviewer, headLines } = ctx;
  if (!findingId) throw new Error("ctx.findingId is required");
  if (!reviewer) throw new Error("ctx.reviewer is required");

  const ruleId = finding.ruleId;
  if (typeof ruleId !== "string" || ruleId.trim() === "") {
    throw new Error("finding.ruleId is required (non-empty string)");
  }
  const message = finding.message;
  if (typeof message !== "string" || message.trim() === "") {
    throw new Error("finding.message is required (non-empty string)");
  }
  const scope = finding.scope ?? "line";
  if (!VALID_SCOPES.has(scope)) {
    throw new Error(`finding.scope must be one of line|file|pr (got "${finding.scope}")`);
  }
  const confidence = finding.confidence;
  if (!VALID_CONFIDENCE.has(confidence)) {
    throw new Error(`finding.confidence must be one of high|medium|low (got "${confidence}")`);
  }
  const level = normalizeLevel(finding);
  const severity = finding.severity ?? null;

  const result = {
    ruleId,
    level,
    message: { text: message },
    properties: {
      findingId,
      ...(severity != null ? { severity } : {}),
      confidence,
      reviewer,
      scope,
    },
  };

  let region;
  let uri;
  if (scope === "pr") {
    // No location at all for a PR-wide finding.
  } else {
    const file = finding.file;
    if (typeof file !== "string" || file.trim() === "") {
      throw new Error(`finding.file is required for scope "${scope}"`);
    }
    uri = file;
    if (scope === "file") {
      if (finding.startLine != null || finding.endLine != null) {
        throw new Error('finding.startLine/endLine are not allowed for scope "file"');
      }
      result.locations = [{ physicalLocation: { artifactLocation: { uri, uriBaseId: SRCROOT } } }];
    } else {
      // scope === "line"
      if (!Array.isArray(headLines)) {
        throw new Error("ctx.headLines is required for scope \"line\"");
      }
      if (finding.startLine == null) {
        throw new Error('finding.startLine is required for scope "line"');
      }
      region = validateRegion(
        { startLine: finding.startLine, endLine: finding.endLine },
        headLines.length,
        "location",
      );
      result.locations = [
        { physicalLocation: { artifactLocation: { uri, uriBaseId: SRCROOT }, region } },
      ];
    }
  }

  const fingerprintInput =
    scope === "line"
      ? { ruleId, scope, uri, headLineText: headLines[region.startLine - 1], message }
      : { ruleId, scope, uri, message };
  result.partialFingerprints = { "codeReview/v1": fingerprintText(fingerprintInput) };

  return result;
}

/**
 * Attach at most one SARIF `fix` to a result, built from worktree-captured
 * hunks.
 *
 * @param {object} result   a SARIF result from buildFindingResult (mutated)
 * @param {object} fix
 * @param {string} fix.description
 * @param {Array<{file: string, kind?: "add"|"rename"|"binary", replacements?: Array<{startLine:number,endLine:number,insertedContent:string}>}>} fix.changes
 * @param {number} fix.hunkCount
 * @param {boolean} [fix.expandedInsertion]
 */
export function attachFix(result, fix) {
  if (!fix || typeof fix.description !== "string" || fix.description.trim() === "") {
    throw new Error("fix.description is required");
  }
  if (!Array.isArray(fix.changes) || fix.changes.length === 0) {
    throw new Error("fix.changes must be a non-empty array");
  }
  const artifactChanges = fix.changes.map((c) => {
    if (typeof c.file !== "string" || c.file.trim() === "") {
      throw new Error("fix change requires a file");
    }
    const artifactLocation = { uri: c.file, uriBaseId: SRCROOT };
    if (c.kind) {
      return { artifactLocation, properties: { kind: c.kind } };
    }
    if (!Array.isArray(c.replacements) || c.replacements.length === 0) {
      throw new Error(`fix change for ${c.file} requires replacements or a kind`);
    }
    return {
      artifactLocation,
      replacements: c.replacements.map((r) => ({
        deletedRegion: { startLine: r.startLine, endLine: r.endLine },
        insertedContent: { text: r.insertedContent },
      })),
    };
  });
  result.fixes = [
    {
      description: { text: fix.description },
      artifactChanges,
      properties: {
        capturedFromWorktree: true,
        hunks: fix.hunkCount ?? 0,
        ...(fix.expandedInsertion ? { expandedInsertion: true } : {}),
      },
    },
  ];
  return result;
}
