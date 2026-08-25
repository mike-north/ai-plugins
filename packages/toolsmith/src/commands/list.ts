/**
 * `toolsmith list` — deterministic inventory of the registry across both
 * scopes, plus hash-drift status and pending staged drafts, emitted as
 * relay-markdown (docs/toolsmith/cli-surface.md §Output model): the agent
 * copies this verbatim into chat; nothing here is composed per-run in prose.
 */
import { existsSync } from "node:fs";
import { readJsonOrNull, readRegistry, isPlainObject, type Registry, type ToolEntry } from "../lib/registry.js";
import {
  projectRoot,
  registryPathFor,
  resolveHome,
  resolveScope,
  sameFile,
  userRegistryPath,
  type Scope,
} from "../lib/scope.js";
import { verifyTool, type VerifyStatus } from "./verify.js";

type DriftState = "pending" | "live-drifted-too" | "staged-missing" | "new";

interface ScopeReport {
  label: string;
  regPath: string;
  parseError: boolean;
  absent: boolean;
  tools: Array<{
    entry: ToolEntry;
    verify: VerifyStatus;
    verifiedPath: string;
  }>;
  drafts: Array<{
    entry: ToolEntry;
    state: DriftState;
  }>;
}

function buildScopeReport(label: string, scope: Scope): ScopeReport {
  const regPath = scope.regPath;
  if (!existsSync(regPath)) {
    return { label, regPath, parseError: false, absent: true, tools: [], drafts: [] };
  }
  const registry: Registry | null = readRegistry(regPath);
  if (!registry) {
    // Distinguish "file exists but won't parse" — the hook fails open on a
    // malformed registry, so the redirect and tamper block are silently
    // disarmed for this scope until the JSON is fixed. Surface prominently.
    const parsed = readJsonOrNull(regPath);
    const parseError = !isPlainObject(parsed) || !Array.isArray((parsed as Record<string, unknown>)["tools"]);
    return { label, regPath, parseError, absent: false, tools: [], drafts: [] };
  }

  const tools = registry.tools
    .filter((t): t is ToolEntry => Boolean(t))
    .map((entry) => {
      const line = verifyTool(entry, scope);
      return { entry, verify: line.status, verifiedPath: line.path };
    });

  const drafts = registry.tools
    .filter((t): t is ToolEntry => Boolean(t?.staged) && typeof t?.staged?.path === "string")
    .map((entry) => {
      const staged = entry.staged!;
      // Three-way drift state (commands/list.md step 5): the pinned hash vs.
      // the live file's on-disk hash vs. the staged file's on-disk hash. The
      // staged hash is computed from disk — staged.sha256 is advisory
      // bookkeeping and never trusted.
      const stagedRel = scope.normalizeStaged(staged.path);
      const stagedAbs = stagedRel ? scope.stagedAbs(stagedRel) : null;
      let state: DriftState;
      if (!stagedAbs || !existsSync(stagedAbs)) {
        state = "staged-missing";
      } else if (entry.status !== "approved") {
        state = "new";
      } else {
        const line = verifyTool(entry, scope);
        state = line.status === "OK" ? "pending" : "live-drifted-too";
      }
      return { entry, state };
    });

  return { label, regPath, parseError: false, absent: false, tools, drafts };
}

/** Neutralize characters that would break a markdown table cell or escape an
 * inline-code span: pipes and newlines always; backticks are replaced with a
 * straight quote because several cells are rendered inside `…` spans, where a
 * backtick cannot be backslash-escaped and would terminate the span (letting
 * registry-controlled text inject into the relay-markdown). */
function mdEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/`/g, "'")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function renderScope(report: ScopeReport, shadowedNames: Set<string>): string[] {
  const lines: string[] = [];
  lines.push(`## ${report.label} tools`);
  lines.push("");
  if (report.parseError) {
    lines.push(
      `**PARSE ERROR:** \`${report.regPath}\` exists but does not parse as a registry ` +
        `(malformed JSON or missing \`tools\` array). The hook fails open on a malformed ` +
        `registry, so the redirect and tamper block for this scope are silently disarmed ` +
        `until the JSON is fixed.`,
    );
    lines.push("");
    return lines;
  }
  if (report.absent) {
    lines.push(`No registry at \`${report.regPath}\` — no ${report.label.toLowerCase()} tools registered.`);
    lines.push("");
    return lines;
  }
  if (report.tools.length === 0) {
    lines.push(`Registry present at \`${report.regPath}\` but it lists no tools.`);
    lines.push("");
    return lines;
  }
  lines.push(`| name | path | status | integrity | purpose | args |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const t of report.tools) {
    const shadowNote =
      report.label === "User" && typeof t.entry.name === "string" && shadowedNames.has(t.entry.name)
        ? " (shadowed by project tool)"
        : "";
    lines.push(
      `| ${mdEscape(t.entry.name)}${shadowNote} | \`${mdEscape(t.entry.path)}\` | ${mdEscape(t.entry.status)} | ` +
        `${t.verify} | ${mdEscape(t.entry.purpose)} | \`${mdEscape(t.entry.args)}\` |`,
    );
  }
  lines.push("");
  if (report.drafts.length > 0) {
    lines.push(`### Pending drafts (${report.label.toLowerCase()} scope)`);
    lines.push("");
    lines.push(`| name | note | since | state |`);
    lines.push(`|---|---|---|---|`);
    for (const d of report.drafts) {
      lines.push(
        `| ${mdEscape(d.entry.name)} | ${mdEscape(d.entry.staged?.note)} | ${mdEscape(d.entry.staged?.since)} | ${d.state} |`,
      );
    }
    lines.push("");
    if (d3(report.drafts, "live-drifted-too")) {
      lines.push(
        `**Warning:** at least one entry is \`live-drifted-too\` — live itself no longer matches its pin, ` +
          `so promoting now would be reviewing a stale diff. Re-verify live first.`,
      );
      lines.push("");
    }
    if (d3(report.drafts, "staged-missing")) {
      lines.push(
        `**Warning:** at least one entry is \`staged-missing\` — the registry claims a pending draft ` +
          `whose staged file does not exist on disk.`,
      );
      lines.push("");
    }
  }
  return lines;
}

function d3(drafts: ScopeReport["drafts"], state: DriftState): boolean {
  return drafts.some((d) => d.state === state);
}

function countByStatus(report: ScopeReport): Record<VerifyStatus, number> {
  const counts: Record<VerifyStatus, number> = { OK: 0, DRIFTED: 0, MISSING: 0, draft: 0, retired: 0 };
  for (const t of report.tools) counts[t.verify] += 1;
  return counts;
}

function summaryLine(label: string, report: ScopeReport): string {
  const c = countByStatus(report);
  return (
    `- **${label}**: ${String(report.tools.length)} tool(s) — ` +
    `${String(c.OK)} OK, ${String(c.DRIFTED)} drifted, ${String(c.MISSING)} missing, ` +
    `${String(c.draft)} draft, ${String(c.retired)} retired; ${String(report.drafts.length)} pending draft(s).`
  );
}

export function runList(): number {
  const root = projectRoot();
  const home = resolveHome();

  // When the session's project root IS the home directory, the "project"
  // registry is the user registry (issue #36) — report user scope only
  // rather than double-reporting the same file under both labels.
  const conflated = Boolean(home) && sameFile(registryPathFor(root), userRegistryPath(home!));

  const reports: ScopeReport[] = [];
  if (!conflated) {
    const projectScope = resolveScope(false);
    if (projectScope.ok) reports.push(buildScopeReport("Project", projectScope.scope));
  }
  const userScope = resolveScope(true);
  if (userScope.ok) reports.push(buildScopeReport("User", userScope.scope));

  const projectReport = reports.find((r) => r.label === "Project");
  const shadowedNames = new Set<string>(
    (projectReport?.tools ?? [])
      .map((t) => t.entry.name)
      .filter((n): n is string => typeof n === "string"),
  );

  const lines: string[] = ["# Toolsmith registry", ""];
  if (conflated) {
    lines.push(
      `_This session's project root is the home directory, so the project and user registries ` +
        `are the same file — reported once, as user scope._`,
      "",
    );
  }
  for (const report of reports) {
    lines.push(...renderScope(report, shadowedNames));
  }

  const userReport = reports.find((r) => r.label === "User");
  const shadowed = (userReport?.tools ?? []).filter(
    (t) => typeof t.entry.name === "string" && shadowedNames.has(t.entry.name),
  );
  if (shadowed.length > 0) {
    lines.push(
      `_A project tool shadows a same-named user tool: ${shadowed
        .map((t) => `\`${String(t.entry.name)}\``)
        .join(", ")} — the project entry governs while this project is active._`,
      "",
    );
  }

  lines.push("## Summary", "");
  for (const report of reports) lines.push(summaryLine(report.label, report));
  lines.push("");

  process.stdout.write(lines.join("\n"));

  const anyBad = reports.some(
    (r) => r.parseError || r.tools.some((t) => t.verify === "DRIFTED" || t.verify === "MISSING"),
  );
  return anyBad ? 1 : 0;
}
