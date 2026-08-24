/**
 * `toolsmith analyze` — the deterministic half of the mining split
 * (docs/toolsmith/cli-surface.md §Verbs): inventories this project's
 * `.claude/toolsmith/history.jsonl`, clusters commands, counts frequency,
 * classifies against the effective watchlist and existing tools' `covers`,
 * and emits the facts as relay-markdown. The AGENT adds the rubric judgment
 * on top (authoring-checklist.md's Compound/Missing/Guarded/Permission-
 * scopable bar, plus script sketches) — reasoning only where it adds value.
 *
 * Sensitivity: the history log stores full command strings verbatim, which
 * can include inline secrets (registry-schema.md §history.jsonl). This
 * report never reproduces raw commands — every emitted example is normalized
 * (values masked) and additionally secret-redacted.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readRegistry, isPlainObject } from "../lib/registry.js";
import { projectRoot, registryPathFor, resolveHome, sameFile, userRegistryPath } from "../lib/scope.js";
import { effectiveWatchlistPatterns, safeTest, toRegExp } from "../lib/watchlist.js";

interface HistoryEntry {
  ts: string | null;
  command: string;
  exitCode: number | null;
}

interface Cluster {
  signature: string;
  count: number;
  failures: number;
  firstTs: string | null;
  lastTs: string | null;
  stages: number;
  watched: boolean;
  coveredBy: string[];
}

/** Redact obvious secret material before anything is emitted. Belt-and-
 * suspenders on top of normalization (which already masks values). */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(Bearer|token|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 <redacted>")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{8,})/g, "<redacted>")
    .replace(/\b(xox[a-z]-[A-Za-z0-9-]{8,})/g, "<redacted>")
    .replace(/\b(sk-[A-Za-z0-9-]{16,})/g, "<redacted>")
    .replace(/\b(AKIA[A-Z0-9]{12,})/g, "<redacted>")
    .replace(/(--?(?:token|password|secret|api-key|apikey)[= ])\S+/gi, "$1<redacted>");
}

/**
 * Normalize a command into a cluster signature: keep the command's shape
 * (executables, subcommands, flag names, pipeline structure) and mask the
 * volatile values (numbers, hashes, quoted strings, flag values, long
 * paths/URLs) so "the same broad operation repeated with only small argument
 * changes" lands in one cluster.
 */
export function normalizeCommand(command: string): string {
  let s = command.replace(/\s+/g, " ").trim();
  // Quoted strings first, so their contents can't leak into later masks.
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '"…"').replace(/'[^']*'/g, "'…'");
  // Flag values: --flag=value -> --flag=…
  s = s.replace(/(--[A-Za-z0-9-]+=)[^\s]+/g, "$1…");
  // Heredoc bodies collapse to their operator.
  s = s.replace(/<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?[\s\S]*$/g, "<<$1 …");
  // URLs: keep scheme+host, mask the rest.
  s = s.replace(/\b(https?:\/\/[^\s/]+)\/[^\s]*/g, "$1/…");
  // Hex hashes / ids, then bare numbers.
  s = s.replace(/\b[0-9a-f]{7,64}\b/g, "HEX");
  s = s.replace(/\b\d{2,}\b/g, "N");
  return s;
}

function parseHistory(historyPath: string): HistoryEntry[] {
  let raw: string;
  try {
    raw = readFileSync(historyPath, "utf8");
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // tolerate torn/corrupt lines — the log is best-effort
    }
    if (!isPlainObject(parsed)) continue;
    const command = parsed["command"];
    if (typeof command !== "string" || !command.trim()) continue;
    const ts = typeof parsed["ts"] === "string" ? parsed["ts"] : null;
    const exitCode = typeof parsed["exitCode"] === "number" ? parsed["exitCode"] : null;
    entries.push({ ts, command, exitCode });
  }
  return entries;
}

function approvedTools(): Array<{ name: string; covers: RegExp[] }> {
  const root = projectRoot();
  const home = resolveHome();
  const projectRegPath = registryPathFor(root);
  const conflated = Boolean(home) && sameFile(projectRegPath, userRegistryPath(home!));
  const registries = [
    ...(conflated ? [] : [readRegistry(projectRegPath)]),
    ...(home ? [readRegistry(userRegistryPath(home))] : []),
  ];
  const tools: Array<{ name: string; covers: RegExp[] }> = [];
  for (const registry of registries) {
    for (const tool of registry?.tools ?? []) {
      if (!tool || tool.status !== "approved") continue;
      const covers = (Array.isArray(tool.covers) ? tool.covers : [])
        .map((p) => (typeof p === "string" ? toRegExp(p) : null))
        .filter((r): r is RegExp => r !== null);
      tools.push({ name: typeof tool.name === "string" ? tool.name : "(unnamed)", covers });
    }
  }
  return tools;
}

const TOP_CLUSTERS = 20;

export function runAnalyze(): number {
  const root = projectRoot();
  const historyPath = join(root, ".claude", "toolsmith", "history.jsonl");

  if (!existsSync(historyPath)) {
    process.stdout.write(
      `# Toolsmith usage analysis\n\nNo history log at \`${historyPath}\` — not enough signal yet. ` +
        `The PostToolUse logger populates it as Bash commands run.\n`,
    );
    return 0;
  }
  const entries = parseHistory(historyPath);
  if (entries.length === 0) {
    process.stdout.write(
      `# Toolsmith usage analysis\n\nHistory log at \`${historyPath}\` is empty or unparseable — not enough signal yet.\n`,
    );
    return 0;
  }

  const home = resolveHome();
  const watchlist = effectiveWatchlistPatterns(
    home ? join(home, ".claude", "toolsmith", "config.json") : null,
    join(root, ".claude", "toolsmith", "config.json"),
  )
    .map((p) => toRegExp(p, "m"))
    .filter((r): r is RegExp => r !== null);
  const tools = approvedTools();

  const clusters = new Map<string, Cluster>();
  let watchedTotal = 0;
  for (const entry of entries) {
    const signature = redactSecrets(normalizeCommand(entry.command));
    const watched = watchlist.some((re) => safeTest(re, entry.command));
    if (watched) watchedTotal++;
    const coveredBy = tools.filter((t) => t.covers.some((re) => safeTest(re, entry.command))).map((t) => t.name);
    const stages = entry.command.split(/\|\||&&|[|;&\n]/).length;
    const existing = clusters.get(signature);
    if (existing) {
      existing.count++;
      if (entry.exitCode !== null && entry.exitCode !== 0) existing.failures++;
      if (entry.ts && (!existing.lastTs || entry.ts > existing.lastTs)) existing.lastTs = entry.ts;
      if (entry.ts && (!existing.firstTs || entry.ts < existing.firstTs)) existing.firstTs = entry.ts;
      existing.watched = existing.watched || watched;
      for (const name of coveredBy) if (!existing.coveredBy.includes(name)) existing.coveredBy.push(name);
    } else {
      clusters.set(signature, {
        signature,
        count: 1,
        failures: entry.exitCode !== null && entry.exitCode !== 0 ? 1 : 0,
        firstTs: entry.ts,
        lastTs: entry.ts,
        stages,
        watched,
        coveredBy,
      });
    }
  }

  // Candidates worth surfacing: repeated, watched, or long pipelines.
  // Deterministic order: count desc, then signature asc.
  const interesting = [...clusters.values()]
    .filter((c) => c.count >= 3 || c.watched || c.stages >= 3)
    .sort((a, b) => b.count - a.count || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0))
    .slice(0, TOP_CLUSTERS);

  const uncoveredWatched = interesting.filter((c) => c.watched && c.coveredBy.length === 0);

  const lines: string[] = [
    `# Toolsmith usage analysis`,
    ``,
    `Deterministic facts mined from \`.claude/toolsmith/history.jsonl\` — ` +
      `${String(entries.length)} logged command(s), ${String(clusters.size)} distinct shape(s), ` +
      `${String(watchedTotal)} watched invocation(s). Examples below are normalized and ` +
      `secret-redacted; the raw log is local, gitignored, and sensitive — do not copy it elsewhere.`,
    ``,
    `## Command clusters (top ${String(Math.min(TOP_CLUSTERS, interesting.length))}: repeated ≥3×, watched, or ≥3 pipeline stages)`,
    ``,
  ];

  if (interesting.length === 0) {
    lines.push(`Nothing repeated, watched, or pipeline-heavy yet — not enough signal to propose tools.`, ``);
  } else {
    lines.push(`| count | fails | watched | covered by | stages | normalized command |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const c of interesting) {
      const sig = c.signature.length > 120 ? c.signature.slice(0, 117) + "…" : c.signature;
      lines.push(
        `| ${String(c.count)} | ${String(c.failures)} | ${c.watched ? "yes" : "no"} | ` +
          `${c.coveredBy.length ? c.coveredBy.map((n) => `\`${n}\``).join(", ") : "—"} | ` +
          `${String(c.stages)} | \`${sig.replace(/\|/g, "\\|").replace(/`/g, "'")}\` |`,
      );
    }
    lines.push(``);
  }

  lines.push(`## Watched but uncovered`, ``);
  if (uncoveredWatched.length === 0) {
    lines.push(`Every watched cluster above is already covered by an approved tool (or nothing watched recurred).`, ``);
  } else {
    lines.push(
      `${String(uncoveredWatched.length)} cluster(s) match the effective watchlist but no approved tool's ` +
        `\`covers\` pattern — the primary candidates for forging:`,
      ``,
    );
    for (const c of uncoveredWatched) {
      const sig = c.signature.length > 120 ? c.signature.slice(0, 117) + "…" : c.signature;
      lines.push(`- ${String(c.count)}× \`${sig.replace(/`/g, "'")}\``);
    }
    lines.push(``);
  }

  lines.push(
    `---`,
    ``,
    `_Facts end here. Rubric judgment (Compound / Missing / Guarded / Permission-scopable, per ` +
      `\`skills/toolsmith/references/authoring-checklist.md\`) and script sketches are the agent's layer on top._`,
    ``,
  );

  process.stdout.write(lines.join("\n"));
  return 0;
}
