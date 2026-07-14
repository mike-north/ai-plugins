#!/usr/bin/env node
// merge-findings — combine every reviewer's SARIF log for a work area into a
// single, deduplicated, capped SARIF log.
//
// Usage:
//   node merge-findings.mjs --work-area <dir> [--max-inline 30] [--allow-unattributed] [-o out.sarif.json]
//
// Steps:
//   1. Load findings/*.sarif.json; assert they share one revisionId+baselineTree
//      (exit 4 if not — the HEAD this review is based on moved underneath it).
//   2. Partition check: the union of every recorded fix's hunks must exactly
//      equal the live worktree's current diff against HEAD. Extra (unattributed)
//      hunks or missing (reverted) recorded hunks are both exit 4, unless
//      --allow-unattributed demotes the extras to a synthetic finding.
//   3. Dedupe findings that share a location and are about the same thing;
//      corroborating reviewers are folded into the winner.
//   4. Order by level → confidence → uri → startLine → findingId; cap the
//      number of inline-eligible (scope "line") findings at --max-inline.
//
// Exit codes: 0 ok, 1 unexpected, 2 usage, 4 drift (revision mismatch,
// partition violation).

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { DriftError, EXIT, UsageError, parseArgs, runCli } from "./lib/cli.mjs";
import { buildRenameMap, parseUnifiedDiff, resolveHunkSurvival } from "./lib/hunks.mjs";
import { SARIF_SCHEMA, SARIF_VERSION, SRCROOT } from "./lib/sarif.mjs";
import { diffWorktree, readState, withLock } from "./lib/snapshot.mjs";

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Load every findings/*.sarif.json under a work area, in a stable (sorted) order. */
export function loadFindingsLogs(workArea) {
  const dir = path.join(workArea, "findings");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sarif.json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

/** Assert every log's run agrees on baselineTree and (when present) revisionId. */
export function assertConsistentProvenance(logs) {
  let baselineTree;
  let revisionId;
  for (const log of logs) {
    const run = log.runs?.[0] ?? {};
    const bt = run.properties?.baselineTree;
    const rid = run.versionControlProvenance?.[0]?.revisionId;
    if (bt !== undefined) {
      if (baselineTree === undefined) baselineTree = bt;
      else if (bt !== baselineTree) {
        throw new DriftError(`baselineTree mismatch across reviewer logs (HEAD moved?): "${baselineTree}" vs "${bt}"`);
      }
    }
    if (rid !== undefined) {
      if (revisionId === undefined) revisionId = rid;
      else if (rid !== revisionId) {
        throw new DriftError(`revisionId mismatch across reviewer logs (HEAD moved?): "${revisionId}" vs "${rid}"`);
      }
    }
  }
  return { baselineTree, revisionId };
}

// ---------------------------------------------------------------------------
// Partition check
// ---------------------------------------------------------------------------

/** A binary or mode-only change carries no line-level hunks at all, so it can never be
 * captured as a finding's fix and never participates in the hunk-based checks below. Always
 * surfaced (never gated by --allow-unattributed, never `demoted`) so it can't reach GitHub
 * silently — this is a normal, visible, design-level finding, not a lesser-visibility appendix
 * entry. */
function buildUnreviewableChangesFinding(files) {
  return {
    ruleId: "binary-changes",
    level: "warning",
    message: {
      text:
        `${files.length} file(s) with binary or mode-only changes cannot be captured by a ` +
        `line-level fix and were not reviewed: ${files.join(", ")}. Review these changes manually.`,
    },
    properties: {
      findingId: "merge-binary-changes",
      confidence: "high",
      reviewer: "merge",
      scope: "pr",
    },
  };
}

/**
 * @returns {object[]} synthetic SARIF results — a "binary-changes" finding
 *   whenever the worktree has any binary/mode-only file change, and/or an
 *   "unattributed-changes" finding when `allowUnattributed` and there were
 *   extra (uncaptured) text hunks. Empty when nothing needs surfacing.
 */
export function partitionCheck({ worktree, state, allowUnattributed }) {
  const live = parseUnifiedDiff(diffWorktree(worktree));
  const renameMap = buildRenameMap(live.files);
  const synthetic = [];

  const unreviewableFiles = [...new Set(live.files.filter((f) => f.kind === "binary" || f.kind === "mode").map((f) => f.file))].sort();
  if (unreviewableFiles.length > 0) {
    synthetic.push(buildUnreviewableChangesFinding(unreviewableFiles));
  }

  const recorded = [];
  for (const [findingId, rec] of Object.entries(state.findings ?? {})) {
    for (const h of rec.hunks ?? []) recorded.push({ findingId, hunk: h });
  }

  // "Missing" (possibly reverted): a recorded hunk that did not SURVIVE in the
  // live diff. Survival tolerates the hunk having merged (git's -U0 diff, zero
  // context) with an adjacent, unrelated edit into one bigger live hunk, and
  // tolerates a rename (via renameMap) — see resolveHunkSurvival's doc comment
  // for exactly what counts as "survived" vs. a genuine revert/overwrite.
  const missing = recorded.filter(({ hunk }) => !resolveHunkSurvival(hunk, live.hunks, renameMap).survived);
  if (missing.length > 0) {
    const owners = [...new Set(missing.map((m) => m.findingId))];
    throw new DriftError(`recorded fix no longer present in the worktree (reverted?): ${owners.join(", ")}`);
  }

  // "Extra" (uncaptured): a live hunk not explained by any recorded hunk. A
  // live hunk that IS the merged superset of some recorded hunk (the adjacent-
  // edit case above) counts as explained in full — see resolveHunkSurvival's
  // doc comment: this can't distinguish "recorded hunk's own part" from
  // "the other, uncaptured part" within that same merged hunk, so a small
  // amount of genuinely-uncaptured content immediately adjacent to a captured
  // fix could be missed here. This mirrors the same tradeoff record-finding.mjs
  // makes when attributing a merged hunk to a new finding (see its
  // captureFix's overlap-detection comment) — favoring never falsely blocking
  // the pipeline over byte-perfect precision.
  const extra = live.hunks.filter((c) => !recorded.some(({ hunk }) => resolveHunkSurvival(hunk, [c], renameMap).survived));
  if (extra.length === 0) return synthetic;

  if (!allowUnattributed) {
    throw new DriftError(
      `uncaptured worktree edits: ${extra.length} hunk(s) in the worktree are not attributed to any finding ` +
        `(pass --allow-unattributed to demote them to a synthetic finding instead)`,
    );
  }

  const files = [...new Set(extra.map((h) => h.file))].sort();
  synthetic.push({
    ruleId: "unattributed-changes",
    level: "warning",
    message: {
      text: `${extra.length} worktree hunk(s) across ${files.length} file(s) were not attributed to any recorded finding: ${files.join(", ")}`,
    },
    properties: {
      findingId: "merge-unattributed",
      confidence: "low",
      reviewer: "merge",
      scope: "pr",
      demoted: "unattributed",
    },
  });
  return synthetic;
}

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

const LEVEL_RANK = { error: 0, warning: 1, note: 2 };
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };
const CONFIDENCE_ORDER = ["low", "medium", "high"];

function bumpConfidence(confidence) {
  const i = CONFIDENCE_ORDER.indexOf(confidence);
  if (i < 0) return confidence;
  return CONFIDENCE_ORDER[Math.min(i + 1, CONFIDENCE_ORDER.length - 1)];
}

function messageTokens(text) {
  const words = String(text ?? "")
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  return new Set((words ?? []).filter((w) => w.length > 4));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Whether two line regions overlap, or are separated by a gap of <= 2 lines. */
function regionsCloseEnough(a, b) {
  if (a.endLine < b.startLine) return b.startLine - a.endLine <= 2;
  if (b.endLine < a.startLine) return a.startLine - b.endLine <= 2;
  return true; // overlap
}

function locationMatch(a, b) {
  const scopeA = a.result.properties?.scope ?? "line";
  const scopeB = b.result.properties?.scope ?? "line";
  if (scopeA !== scopeB) return false;
  if (scopeA === "pr") return true;
  const uriA = a.result.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
  const uriB = b.result.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
  if (uriA == null || uriA !== uriB) return false;
  if (scopeA === "file") return true;
  const ra = a.result.locations?.[0]?.physicalLocation?.region;
  const rb = b.result.locations?.[0]?.physicalLocation?.region;
  if (!ra || !rb) return false;
  return regionsCloseEnough(ra, rb);
}

function isDuplicate(a, b) {
  if (!locationMatch(a, b)) return false;
  if (a.result.ruleId === b.result.ruleId) return true;
  return jaccard(messageTokens(a.result.message?.text), messageTokens(b.result.message?.text)) >= 0.5;
}

class DisjointSet {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function compareForWinner(a, b) {
  const la = LEVEL_RANK[a.result.level] ?? 3;
  const lb = LEVEL_RANK[b.result.level] ?? 3;
  if (la !== lb) return la - lb;
  const fa = Array.isArray(a.result.fixes) && a.result.fixes.length > 0 ? 0 : 1;
  const fb = Array.isArray(b.result.fixes) && b.result.fixes.length > 0 ? 0 : 1;
  if (fa !== fb) return fa - fb;
  const ca = CONFIDENCE_RANK[a.result.properties?.confidence] ?? 3;
  const cb = CONFIDENCE_RANK[b.result.properties?.confidence] ?? 3;
  if (ca !== cb) return ca - cb;
  return String(a.result.properties?.findingId).localeCompare(String(b.result.properties?.findingId));
}

/**
 * @param {{ reviewer: string, result: object }[]} entries
 * @returns {{ reviewer: string, result: object }[]} winners, one per dedupe cluster
 */
export function resolveDuplicates(entries) {
  const dsu = new DisjointSet(entries.length);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (isDuplicate(entries[i], entries[j])) dsu.union(i, j);
    }
  }
  const clusters = new Map();
  entries.forEach((e, i) => {
    const root = dsu.find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(e);
  });

  const winners = [];
  for (const cluster of clusters.values()) {
    cluster.sort(compareForWinner);
    const [winner, ...losers] = cluster;
    for (const loser of losers) {
      if (Array.isArray(loser.result.fixes) && loser.result.fixes.length > 0) {
        throw new DriftError(
          `merge dedupe would drop a fix: ${loser.result.properties?.findingId} has a fix but lost to ` +
            `${winner.result.properties?.findingId}`,
        );
      }
    }
    if (losers.length > 0) {
      const corroborators = new Set(winner.result.properties.corroboratedBy ?? []);
      for (const loser of losers) corroborators.add(loser.reviewer);
      winner.result.properties.corroboratedBy = [...corroborators].sort();
      winner.result.properties.confidence = bumpConfidence(winner.result.properties.confidence);
    }
    winners.push(winner);
  }
  return winners;
}

// ---------------------------------------------------------------------------
// Ordering + cap
// ---------------------------------------------------------------------------

function compareForOutputOrder(a, b) {
  const la = LEVEL_RANK[a.result.level] ?? 3;
  const lb = LEVEL_RANK[b.result.level] ?? 3;
  if (la !== lb) return la - lb;
  const ca = CONFIDENCE_RANK[a.result.properties?.confidence] ?? 3;
  const cb = CONFIDENCE_RANK[b.result.properties?.confidence] ?? 3;
  if (ca !== cb) return ca - cb;
  const uriA = a.result.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? "";
  const uriB = b.result.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? "";
  if (uriA !== uriB) return uriA.localeCompare(uriB);
  const startA = a.result.locations?.[0]?.physicalLocation?.region?.startLine ?? 0;
  const startB = b.result.locations?.[0]?.physicalLocation?.region?.startLine ?? 0;
  if (startA !== startB) return startA - startB;
  return String(a.result.properties?.findingId).localeCompare(String(b.result.properties?.findingId));
}

/** Demote scope:"line" findings beyond `maxInline` (scope file|pr never consume a slot). Mutates in place. */
export function applyInlineCap(ordered, maxInline) {
  let count = 0;
  for (const entry of ordered) {
    const scope = entry.result.properties?.scope ?? "line";
    if (scope !== "line") continue;
    count++;
    if (count > maxInline) {
      entry.result.properties.demoted = "overflow";
    }
  }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * @returns {{ log: object, summary: { total: number, merged: number, duplicates: number,
 *   unattributed: number, inline: number, overflow: number } }}
 */
export function mergeFindings({ workArea, maxInline = 30, allowUnattributed = false }) {
  if (!workArea) throw new UsageError("workArea is required");
  workArea = path.resolve(workArea); // see record-finding.mjs for why this must be absolute
  // Acquired for the same reason record-finding.mjs holds it: reads state.json
  // and every reviewer's SARIF log, which record-finding.mjs mutates under
  // this same lock — without it, a merge running concurrently with an
  // in-progress capture (the normal case with parallel reviewer subagents)
  // could observe those files mid-write.
  return withLock(workArea, () => mergeFindingsLocked({ workArea, maxInline, allowUnattributed }));
}

function mergeFindingsLocked({ workArea, maxInline, allowUnattributed }) {
  const state = readState(workArea);
  const logs = loadFindingsLogs(workArea);
  const { baselineTree, revisionId } = assertConsistentProvenance(logs);

  const entries = [];
  const reviewers = new Set();
  for (const log of logs) {
    for (const result of log.runs?.[0]?.results ?? []) {
      const reviewer = result.properties?.reviewer ?? "unknown";
      reviewers.add(reviewer);
      entries.push({ reviewer, result });
    }
  }

  const synthetic = partitionCheck({ worktree: state.worktree, state, allowUnattributed });

  const winners = resolveDuplicates(entries);
  const duplicates = entries.length - winners.length;
  for (const result of synthetic) {
    reviewers.add("merge");
    winners.push({ reviewer: "merge", result });
  }
  const unattributed = synthetic.some((r) => r.properties?.demoted === "unattributed");

  winners.sort(compareForOutputOrder);
  applyInlineCap(winners, maxInline);

  const inline = winners.filter(
    (e) => (e.result.properties?.scope ?? "line") === "line" && e.result.properties?.demoted !== "overflow",
  ).length;
  const overflow = winners.filter((e) => e.result.properties?.demoted === "overflow").length;

  const run = {
    tool: { driver: { name: "code-review", rules: [] } },
    originalUriBaseIds: { [SRCROOT]: { uri: pathToFileURL(path.resolve(state.worktree) + path.sep).href } },
    properties: {
      reviewers: [...reviewers].sort(),
      workArea,
      worktree: path.resolve(state.worktree),
      ...(state.pr != null ? { prNumber: state.pr } : {}),
      baselineTree: baselineTree ?? state.baselineTree,
    },
    results: winners.map((e) => e.result),
  };
  if (state.repositoryUri) {
    run.versionControlProvenance = [{ repositoryUri: state.repositoryUri, revisionId: revisionId ?? state.headSha, branch: state.branch }];
  }

  return {
    log: { $schema: SARIF_SCHEMA, version: SARIF_VERSION, runs: [run] },
    summary: { total: entries.length, merged: winners.length, duplicates, unattributed: unattributed ? 1 : 0, inline, overflow },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workArea = args["work-area"];
  if (!workArea || workArea === true) throw new UsageError("--work-area <dir> is required");
  const maxInline = args["max-inline"] != null && args["max-inline"] !== true ? Number(args["max-inline"]) : 30;
  const allowUnattributed = args["allow-unattributed"] === true;
  const outPath = typeof args.o === "string" ? args.o : typeof args.out === "string" ? args.out : undefined;

  const { log, summary } = mergeFindings({ workArea, maxInline, allowUnattributed });
  const text = JSON.stringify(log, null, 2) + "\n";
  if (outPath) {
    fs.writeFileSync(outPath, text);
  } else {
    process.stdout.write(text);
  }
  process.stderr.write(
    `${summary.total} finding(s) → ${summary.merged} after dedupe (${summary.duplicates} duplicate(s) removed), ` +
      `${summary.unattributed} unattributed, ${summary.inline} inline / ${summary.overflow} overflow\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(main);
  process.exit(process.exitCode ?? EXIT.OK);
}
