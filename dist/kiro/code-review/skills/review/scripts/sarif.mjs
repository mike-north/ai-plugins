// Minimal SARIF 2.1.0 helpers for the code-review plugin.
//
// Deterministic core: builds and validates a small, valid subset of SARIF so that
// reviewer agents never hand-author JSON or resolve/validate line numbers themselves.
// Zero dependencies — runs under bare `node`.
//
// SARIF reference: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
// JSON schema:     https://json.schemastore.org/sarif-2.1.0.json

import * as fs from "node:fs";
import * as path from "node:path";

export const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
export const SARIF_VERSION = "2.1.0";

/** Human severity vocabulary → SARIF level. */
export const SEVERITY_TO_LEVEL = {
  critical: "error",
  important: "warning",
  suggestion: "note",
};

export const VALID_LEVELS = new Set(["error", "warning", "note"]);

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

/** Build an empty, valid SARIF log for one lens. */
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

/** Count the lines in a file (for region bounds checks). */
function countLines(absPath) {
  const text = fs.readFileSync(absPath, "utf8");
  if (text === "") return 0;
  // A trailing newline does not introduce an extra line.
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

/**
 * Validate and normalize a region {startLine, endLine?} against a file's length.
 * Returns a normalized region or throws with a precise message.
 */
function validateRegion(region, fileLineCount, label) {
  const startLine = region.startLine;
  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new Error(`${label}: startLine must be an integer >= 1 (got ${startLine})`);
  }
  if (startLine > fileLineCount) {
    throw new Error(
      `${label}: startLine ${startLine} is past end of file (${fileLineCount} lines)`,
    );
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
    if (endLine > fileLineCount) {
      throw new Error(
        `${label}: endLine ${endLine} is past end of file (${fileLineCount} lines)`,
      );
    }
  }
  return { startLine, endLine };
}

/**
 * Validate a finding and convert it to a SARIF `result` object.
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
export function writeLog(filePath, log) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(log, null, 2) + "\n");
}

/** Append a result to the first run of a log (mutates and returns it). */
export function addResult(log, result) {
  log.runs[0].results.push(result);
  return log;
}
