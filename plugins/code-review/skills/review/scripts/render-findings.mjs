#!/usr/bin/env node
// render-findings — deterministically render lens SARIF files into a
// human-readable terminal summary. Agents never format this markdown themselves.
//
// Usage:
//   node render-findings.mjs --work-area <dir>     # reads <dir>/findings/*.sarif.json
//   node render-findings.mjs <file.sarif.json> ... # explicit files

import * as fs from "node:fs";
import * as path from "node:path";
import { isMainModule } from "./lib/cli.mjs";

const LEVEL_ORDER = ["error", "warning", "note"];
const LEVEL_LABEL = { error: "CRITICAL", warning: "IMPORTANT", note: "SUGGESTION" };

/**
 * Render an array of SARIF log objects into a summary string.
 * @param {object[]} logs
 * @returns {string}
 */
export function renderFindings(logs) {
  // Flatten results, tagging each with its lens (from tool.driver.name).
  const rows = [];
  for (const log of logs) {
    for (const run of log.runs ?? []) {
      const driver = run.tool?.driver?.name ?? "unknown";
      const lens = driver.startsWith("code-review:") ? driver.slice("code-review:".length) : driver;
      for (const r of run.results ?? []) {
        const loc = r.locations?.[0]?.physicalLocation;
        rows.push({
          lens,
          level: r.level ?? "note",
          ruleId: r.ruleId ?? "",
          message: r.message?.text ?? "",
          file: loc?.artifactLocation?.uri ?? null,
          startLine: loc?.region?.startLine ?? null,
          hasFix: Array.isArray(r.fixes) && r.fixes.length > 0,
        });
      }
    }
  }

  const counts = { error: 0, warning: 0, note: 0 };
  for (const row of rows) if (row.level in counts) counts[row.level]++;

  const lines = [];
  lines.push("# Code Review — Findings");
  lines.push("");
  lines.push(
    `${rows.length} finding(s): ${counts.error} critical, ${counts.warning} important, ${counts.note} suggestion`,
  );
  lines.push("");

  if (rows.length === 0) {
    lines.push("No findings.");
    return lines.join("\n") + "\n";
  }

  for (const level of LEVEL_ORDER) {
    const group = rows.filter((r) => r.level === level);
    if (group.length === 0) continue;
    lines.push(`## ${LEVEL_LABEL[level]} (${group.length})`);
    lines.push("");
    for (const r of group) {
      const where = r.file ? `${r.file}${r.startLine != null ? `:${r.startLine}` : ""}` : "(general)";
      const fix = r.hasFix ? " [suggested fix]" : "";
      lines.push(`- **${where}** — ${r.message} _(${r.lens}/${r.ruleId})_${fix}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** Read every findings/*.sarif.json under a work area. */
export function loadWorkAreaLogs(workArea) {
  const dir = path.join(workArea, "findings");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sarif.json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

function main() {
  const argv = process.argv.slice(2);
  let logs = [];
  const waIdx = argv.indexOf("--work-area");
  if (waIdx !== -1) {
    logs = loadWorkAreaLogs(argv[waIdx + 1]);
  } else {
    logs = argv
      .filter((a) => !a.startsWith("--"))
      .map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  }
  process.stdout.write(renderFindings(logs));
}

if (isMainModule(import.meta.url)) {
  main();
}
