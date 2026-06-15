#!/usr/bin/env node
// record-finding — append ONE validated finding to a lens's SARIF file.
//
// A reviewer agent calls this per finding instead of hand-authoring JSON. The
// tool resolves/validates line numbers against the real file, maps severity to
// SARIF level, encodes any suggested fix as a SARIF `fix`, and writes valid SARIF.
//
// Usage:
//   node record-finding.mjs --work-area <dir> --lens <id> [--root <dir>] --json '<finding>'
//   echo '<finding-json>' | node record-finding.mjs --work-area <dir> --lens <id> [--root <dir>]
//
// Finding JSON (see sarif.mjs buildResult for the full contract):
//   { "ruleId": "logic-bug", "severity": "critical", "message": "...",
//     "file": "src/x.ts", "startLine": 42, "endLine": 45,
//     "fix": { "replacement": "...", "startLine": 42, "endLine": 45 } }
// Omit file for a general (no-location) finding. `level` (error|warning|note)
// may be used instead of `severity`.

import * as fs from "node:fs";
import * as path from "node:path";
import { buildResult, loadLog, writeLog, addResult } from "./sarif.mjs";

/**
 * Record a finding into <workArea>/findings/<lens>.sarif.json.
 * @returns {{ filePath: string, result: object }}
 */
export function recordFinding({ workArea, lens, finding, root = process.cwd() }) {
  if (!workArea) throw new Error("workArea is required");
  if (!lens) throw new Error("lens is required");
  const result = buildResult(finding, root); // validates; throws on bad input
  const filePath = path.join(workArea, "findings", `${lens}.sarif.json`);
  const log = loadLog(filePath, lens);
  addResult(log, result);
  writeLog(filePath, log);
  return { filePath, result };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next == null || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = args.json ?? readStdin();
  if (!raw || (typeof raw === "string" && raw.trim() === "")) {
    process.stderr.write("error: no finding JSON provided (--json or stdin)\n");
    process.exit(2);
  }
  let finding;
  try {
    finding = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`error: finding is not valid JSON: ${e.message}\n`);
    process.exit(2);
  }
  try {
    const { filePath, result } = recordFinding({
      workArea: args["work-area"],
      lens: args.lens,
      finding,
      root: args.root ?? process.cwd(),
    });
    const loc = result.locations?.[0]?.physicalLocation;
    const where = loc
      ? `${loc.artifactLocation.uri}${loc.region ? `:${loc.region.startLine}` : ""}`
      : "(general)";
    process.stdout.write(`recorded [${result.level}] ${result.ruleId} ${where} → ${filePath}\n`);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
