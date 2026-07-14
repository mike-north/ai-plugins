#!/usr/bin/env node
// post-review — post a merged SARIF log (merge-findings.mjs output) as one
// PENDING GitHub pull-request review: line-scoped findings become review
// threads (with a live ```suggestion``` fence when the finding carries a
// clean, small fix), design-level (scope file|pr) findings and anything that
// cannot be anchored on the PR's current diff go into the review body.
//
// Usage:
//   node post-review.mjs --sarif <merged.sarif.json> [--pr-url U | --repo o/r --pr N]
//     [--host H] [--dry-run] [--force-recreate] [--work-area <dir>]
//
// The review's worktree (needed for suggestion-fence gap-filling and diff-
// block reconstruction, both of which read HEAD blobs) is resolved from
// `run.properties.worktree` directly when present (merge-findings.mjs writes
// this); `--work-area` is an addition beyond the base spec that overrides it
// via that work area's own state.json — useful for a merged SARIF predating
// the direct property, or to point at a different work area entirely.
//
// A PENDING review is only ever deleted (to be recreated fresh) when every
// part of it — its own body AND every inline comment — carries our marker
// (see isPendingReviewFullyOurs); anything else is treated as foreign and
// left untouched. `--force-recreate` is the explicit override: it deletes
// every PENDING review on the PR regardless of that check.
//
// Exit codes: 0 ok, 1 unexpected, 2 usage, 3 validation (dry-run only: any
// finding could not be anchored on the diff), 4 head drift (PR head moved
// since the SARIF was captured — no mutation is made), 5 partial post (some
// threads landed, some did not — see the JSON report), 6 a foreign PENDING
// review already exists on this PR (never deleted or touched, unless
// --force-recreate is given).

import * as fs from "node:fs";
import { CliError, DriftError, EXIT, UsageError, ValidationError, parseArgs, runCli } from "./lib/cli.mjs";
import { api, currentLogin, graphql } from "./lib/gh.mjs";
import { resolvePrRef } from "./lib/gh.mjs";
import { parseHunks, rangeContains } from "./lib/hunks.mjs";
import { readHeadBlob } from "./lib/snapshot.mjs";
import { reconstructDiffBlock, renderGithubBody } from "./render-review.mjs";

export class ForeignPendingReviewError extends CliError {
  constructor(message) {
    super(message, EXIT.FOREIGN_PENDING);
  }
}

const MARKER_RE = /<!-- code-review:v1 finding:(\S+) part:(\d+)\/(\d+) -->/;
const MARKER_PREFIX = "<!-- code-review:v1";

/** Build the hidden marker embedded at the end of every thread body. */
export function buildMarker(findingId, partIndex, partTotal) {
  return `<!-- code-review:v1 finding:${findingId} part:${partIndex}/${partTotal} -->`;
}

/** Parse a marker out of a thread/comment body; null if absent. */
export function parseMarker(body) {
  const m = typeof body === "string" ? MARKER_RE.exec(body) : null;
  return m ? { findingId: m[1], part: Number(m[2]), total: Number(m[3]) } : null;
}

// ---------------------------------------------------------------------------
// PR file / hunk-range index
// ---------------------------------------------------------------------------

/** @returns {Map<string, {status: string, ranges: {startLine:number,endLine:number}[]}>} */
export function buildFileIndex(files) {
  const index = new Map();
  for (const f of files ?? []) {
    index.set(f.filename, { status: f.status, ranges: parseHunks(f.patch) });
  }
  return index;
}

function isAnchorable(file, region, fileIndex) {
  if (!file || !region) return false;
  const entry = fileIndex.get(file);
  if (!entry) return false;
  return rangeContains(entry.ranges, region.startLine, region.endLine);
}

// ---------------------------------------------------------------------------
// Suggestion fences
// ---------------------------------------------------------------------------

function longestBacktickRun(text) {
  const matches = typeof text === "string" ? text.match(/`+/g) : null;
  return (matches ?? []).reduce((max, m) => Math.max(max, m.length), 0);
}

/** A ```suggestion``` fence for `insertedText`; empty text yields a valid empty (pure-deletion) fence. */
export function buildSuggestionFence(insertedText) {
  const fenceLen = Math.max(longestBacktickRun(insertedText) + 1, 3);
  const fence = "`".repeat(fenceLen);
  const body = insertedText === "" ? "" : `${insertedText}\n`;
  return `${fence}suggestion\n${body}${fence}`;
}

function splitInserted(text) {
  const t = text ?? "";
  return t === "" ? [] : t.split("\n");
}

const MAX_CLUSTERS = 3;
const MAX_REPLACEMENT_LINES = 100;
const COALESCE_GAP = 2;

/** Whether integer ranges [aStart,aEnd] and [bStart,bEnd] share any line. */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Coalesce a fix's same-file replacements whose deletedRegions are separated
 * by <= COALESCE_GAP unchanged HEAD lines into single clusters (each becomes
 * one suggestion-eligible thread); gaps are filled with real HEAD content so
 * the suggestion is a valid contiguous replacement.
 *
 * A gap is never bridged if it intersects another finding's own fix range
 * (`otherRangesByFile`) — coalescing across it would read stale HEAD content
 * where that other finding's fix already proposes different content, and
 * would produce two overlapping suggestion threads in the GitHub UI. Such a
 * gap is treated as a hard boundary: the replacements on either side become
 * separate clusters instead, exactly as if the gap were too large.
 *
 * @param {Map<string, {startLine:number, endLine:number}[]>} [otherRangesByFile]
 * @returns {{ oversized: boolean, clusters: {path:string, startLine:number, endLine:number, insertedLines:string[]}[] }}
 */
export function buildFixClusters(fix, { getHeadLines, otherRangesByFile = new Map() }) {
  const hasWholeFileChange = (fix.artifactChanges ?? []).some(
    (c) => !Array.isArray(c.replacements) || c.replacements.length === 0,
  );
  let maxReplLen = 0;
  const clusters = [];
  for (const change of fix.artifactChanges ?? []) {
    if (!Array.isArray(change.replacements) || change.replacements.length === 0) continue;
    const file = change.artifactLocation.uri;
    const otherRanges = otherRangesByFile.get(file) ?? [];
    const sorted = [...change.replacements].sort((a, b) => a.deletedRegion.startLine - b.deletedRegion.startLine);
    let cluster = null;
    for (const r of sorted) {
      const len = r.deletedRegion.endLine - r.deletedRegion.startLine + 1;
      maxReplLen = Math.max(maxReplLen, len);
      const gapStart = cluster ? cluster.endLine + 1 : undefined;
      const gapEnd = r.deletedRegion.startLine - 1;
      const gapBlocked =
        cluster != null &&
        gapEnd >= gapStart &&
        otherRanges.some((o) => rangesOverlap(gapStart, gapEnd, o.startLine, o.endLine));
      if (cluster && cluster.path === file && r.deletedRegion.startLine - cluster.endLine - 1 <= COALESCE_GAP && !gapBlocked) {
        const headLines = getHeadLines(file);
        const gapLines = [];
        for (let ln = cluster.endLine + 1; ln < r.deletedRegion.startLine; ln++) gapLines.push(headLines[ln - 1] ?? "");
        cluster.insertedLines.push(...gapLines, ...splitInserted(r.insertedContent?.text));
        cluster.endLine = r.deletedRegion.endLine;
      } else {
        cluster = {
          path: file,
          startLine: r.deletedRegion.startLine,
          endLine: r.deletedRegion.endLine,
          insertedLines: splitInserted(r.insertedContent?.text),
        };
        clusters.push(cluster);
      }
    }
  }
  const oversized = hasWholeFileChange || clusters.length > MAX_CLUSTERS || maxReplLen > MAX_REPLACEMENT_LINES;
  return { oversized, clusters };
}

// ---------------------------------------------------------------------------
// Per-finding posting plan
// ---------------------------------------------------------------------------

function buildBody({ message, fixDescription, suggestion, diffBlock, findingId, partIndex, partTotal }) {
  const parts = [message];
  if (fixDescription) parts.push(`*Suggested fix: ${fixDescription}*`);
  if (suggestion) parts.push(suggestion);
  if (diffBlock) parts.push(diffBlock);
  parts.push(buildMarker(findingId, partIndex, partTotal));
  return parts.join("\n\n");
}

/** A candidate thread's `{startLine, line}` pair, omitting startLine when it equals line. */
function threadLineFields(region) {
  return region.startLine === region.endLine
    ? { startLine: undefined, line: region.endLine }
    : { startLine: region.startLine, line: region.endLine };
}

/**
 * Decide how one scope:"line", not-already-demoted result should be posted:
 * a set of suggestion-fence threads (the fix is small/clean and every derived
 * thread anchors on the diff), a single anchored diff-block comment at the
 * finding's own location (the fix was too large/messy, or a derived thread
 * didn't anchor, but the finding's own location does), or full demotion to
 * the review body (nothing about this finding anchors on the diff).
 *
 * @param {Map<string, {startLine:number, endLine:number}[]>} [otherRangesByFile]
 *   every OTHER finding's own fix ranges (same file), so this finding's
 *   coalescing never bridges a gap another finding's fix already occupies.
 * @returns {{kind:"threads", threads: object[]} | {kind:"anchored-diff", thread: object} | {kind:"demoted", reason: string}}
 */
export function planForResult(result, { fileIndex, getHeadLines, otherRangesByFile }) {
  const findingId = result.properties?.findingId;
  const message = result.message?.text ?? "";
  const loc = result.locations?.[0]?.physicalLocation;
  const file = loc?.artifactLocation?.uri;
  const region = loc?.region;
  const primaryOk = isAnchorable(file, region, fileIndex);
  const fix = result.fixes?.[0];

  if (fix) {
    const { oversized, clusters } = buildFixClusters(fix, { getHeadLines, otherRangesByFile });
    if (!oversized) {
      const total = clusters.length;
      const candidates = clusters.map((c, i) => {
        const { startLine, line } = threadLineFields({ startLine: c.startLine, endLine: c.endLine });
        return {
          path: c.path,
          startLine,
          line,
          body: buildBody({
            message,
            fixDescription: result.fixes[0].description?.text,
            suggestion: buildSuggestionFence(c.insertedLines.join("\n")),
            findingId,
            partIndex: i + 1,
            partTotal: total,
          }),
        };
      });
      const allAnchorable = clusters.every((c) => isAnchorable(c.path, { startLine: c.startLine, endLine: c.endLine }, fileIndex));
      if (allAnchorable) return { kind: "threads", threads: candidates };
    }
    if (primaryOk) {
      const { startLine, line } = threadLineFields(region);
      return {
        kind: "anchored-diff",
        thread: {
          path: file,
          startLine,
          line,
          body: buildBody({
            message,
            fixDescription: fix.description?.text,
            diffBlock: reconstructDiffBlock(fix, getHeadLines),
            findingId,
            partIndex: 1,
            partTotal: 1,
          }),
        },
      };
    }
    return { kind: "demoted", reason: "fix is not anchorable on the PR's current diff" };
  }

  if (primaryOk) {
    const { startLine, line } = threadLineFields(region);
    return {
      kind: "threads",
      threads: [{ path: file, startLine, line, body: buildBody({ message, findingId, partIndex: 1, partTotal: 1 }) }],
    };
  }
  return { kind: "demoted", reason: "location is not on the PR's current diff" };
}

// ---------------------------------------------------------------------------
// Whole-log mutation plan
// ---------------------------------------------------------------------------

/** Every finding-with-a-fix's own replacement ranges, per file, tagged with the owning findingId. */
function collectFixRangesByFile(results) {
  const byFile = new Map();
  for (const result of results) {
    const findingId = result.properties?.findingId;
    for (const change of result.fixes?.[0]?.artifactChanges ?? []) {
      if (!Array.isArray(change.replacements)) continue;
      const file = change.artifactLocation?.uri;
      if (!file) continue;
      if (!byFile.has(file)) byFile.set(file, []);
      for (const rep of change.replacements) {
        byFile.get(file).push({ findingId, startLine: rep.deletedRegion.startLine, endLine: rep.deletedRegion.endLine });
      }
    }
  }
  return byFile;
}

/** `allFixRangesByFile`, filtered to exclude `findingId`'s own ranges — i.e. every OTHER finding's ranges. */
function otherFindingsRangesByFile(allFixRangesByFile, findingId) {
  const out = new Map();
  for (const [file, ranges] of allFixRangesByFile) {
    const others = ranges.filter((r) => r.findingId !== findingId);
    if (others.length > 0) out.set(file, others);
  }
  return out;
}

/**
 * @returns {{
 *   threads: object[],
 *   demotions: {result: object, reason: string, pre: boolean}[],
 *   designLevel: object[],
 *   fileIndex: Map,
 * }}
 */
export function buildMutationPlan(log, files, { getHeadLines }) {
  const fileIndex = buildFileIndex(files);
  const results = log.runs?.[0]?.results ?? [];
  const allFixRangesByFile = collectFixRangesByFile(results);

  const threads = [];
  const demotions = [];
  const designLevel = [];

  for (const result of results) {
    const scope = result.properties?.scope ?? "line";
    if (scope !== "line") {
      designLevel.push(result);
      continue;
    }
    if (result.properties?.demoted != null) {
      demotions.push({ result, reason: result.properties.demoted, pre: true });
      continue;
    }
    const otherRangesByFile = otherFindingsRangesByFile(allFixRangesByFile, result.properties?.findingId);
    const plan = planForResult(result, { fileIndex, getHeadLines, otherRangesByFile });
    if (plan.kind === "threads") threads.push(...plan.threads);
    else if (plan.kind === "anchored-diff") threads.push(plan.thread);
    else demotions.push({ result, reason: plan.reason, pre: false });
  }

  return { threads, demotions, designLevel, fileIndex };
}

/** Clone `log`, stamping `properties.demoted` on every newly (non-`pre`) demoted result, for rendering. */
export function applyDemotions(log, demotions) {
  const newlyDemoted = new Map(demotions.filter((d) => !d.pre).map((d) => [d.result.properties.findingId, d.reason]));
  if (newlyDemoted.size === 0) return log;
  const clone = JSON.parse(JSON.stringify(log));
  for (const r of clone.runs[0].results) {
    const fid = r.properties?.findingId;
    if (newlyDemoted.has(fid)) r.properties.demoted = newlyDemoted.get(fid);
  }
  return clone;
}

/** Convert a candidate thread to the GraphQL `DraftPullRequestReviewThread` shape. */
export function toGithubThreadInput(t) {
  const th = { path: t.path, line: t.line, side: "RIGHT", body: t.body };
  if (t.startLine != null) {
    th.startLine = t.startLine;
    th.startSide = "RIGHT";
  }
  return th;
}

// ---------------------------------------------------------------------------
// GraphQL mutations
//
// Field shapes verified 2026-07-14 via live read-only introspection against
// github.com's real GraphQL schema (`__type(name: "...")`), not just docs:
// `AddPullRequestReviewInput` (pullRequestId!, body, event, threads),
// `AddPullRequestReviewThreadInput` (path, body!, pullRequestId, pullRequestReviewId,
// line, side, startLine, startSide, subjectType), `UpdatePullRequestReviewInput`
// (pullRequestReviewId!, body!), `DraftPullRequestReviewThread` (path, line, side,
// startLine, startSide, body!), and the `DiffSide` enum (LEFT, RIGHT — matches
// the "RIGHT" used throughout this file). `PullRequestReviewEvent` has no PENDING
// member (COMMENT/APPROVE/REQUEST_CHANGES/DISMISS only) — the only way to leave
// a review PENDING is to omit `event` entirely, which is what every mutation
// below does; `PullRequestReviewState.PENDING` ("a review that has not yet been
// submitted") confirms that's a real, addressable state. No shape discrepancies
// were found against this file's original (pre-introspection) mutation text.
// Some of this file's own variable declarations mark technically-nullable input
// fields as GraphQL non-null (e.g. `$body: String!` where the schema's `body` on
// `AddPullRequestReviewInput` is nullable) — harmless (a value is always
// supplied here) and left as documentation of what this code actually requires.
// @see https://docs.github.com/en/graphql/reference/mutations#addpullrequestreview
// @see https://docs.github.com/en/graphql/reference/mutations#addpullrequestreviewthread
// @see https://docs.github.com/en/graphql/reference/mutations#updatepullrequestreview
// @see https://docs.github.com/en/graphql/reference/input-objects#draftpullrequestreviewthread
// ---------------------------------------------------------------------------

const ADD_REVIEW_MUTATION = `
mutation($pullRequestId: ID!, $body: String!, $threads: [DraftPullRequestReviewThread!]) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, body: $body, threads: $threads }) {
    pullRequestReview { id url }
  }
}`;

const ADD_EMPTY_REVIEW_MUTATION = `
mutation($pullRequestId: ID!, $body: String!) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, body: $body }) {
    pullRequestReview { id url }
  }
}`;

const ADD_THREAD_MUTATION = `
mutation($pullRequestId: ID!, $pullRequestReviewId: ID!, $path: String!, $body: String!, $line: Int!, $side: DiffSide!, $startLine: Int, $startSide: DiffSide) {
  addPullRequestReviewThread(input: { pullRequestId: $pullRequestId, pullRequestReviewId: $pullRequestReviewId, path: $path, body: $body, line: $line, side: $side, startLine: $startLine, startSide: $startSide }) {
    thread { id }
  }
}`;

const UPDATE_REVIEW_MUTATION = `
mutation($pullRequestReviewId: ID!, $body: String!) {
  updatePullRequestReview(input: { pullRequestReviewId: $pullRequestReviewId, body: $body }) {
    pullRequestReview { id }
  }
}`;

// ---------------------------------------------------------------------------
// Pending-review safety check (marker-scoped delete)
// ---------------------------------------------------------------------------

/**
 * Whether a PENDING review is entirely ours: its own body carries our marker
 * AND every one of its inline comments does too. Checking only the review's
 * top-level body is not enough — a human can open our bot's still-pending
 * review in the GitHub UI and add their own comment to it before it's
 * submitted; deleting that review to recreate it would silently destroy that
 * comment. `--force-recreate` bypasses this check entirely (see main()).
 */
export function isPendingReviewFullyOurs(host, owner, repo, number, review) {
  if (typeof review.body !== "string" || !review.body.includes(MARKER_PREFIX)) return false;
  const comments = api(host, `repos/${owner}/${repo}/pulls/${number}/reviews/${review.id}/comments`, { paginate: true });
  return comments.every((c) => typeof c.body === "string" && c.body.includes(MARKER_PREFIX));
}

// ---------------------------------------------------------------------------
// Fallback / resume (invoked when the single batched `addPullRequestReview`
// GraphQL call fails, since GitHub may have partially applied the batch)
// ---------------------------------------------------------------------------

/**
 * @param {object} ctx
 * @returns {{ partial: boolean, report: { mode: string, posted: number, demoted: number, failed: number, reviewUrl?: string } }}
 */
export function runFallback({ host, owner, repo, number, pullRequestId, body, threads, login, demotedCount }) {
  const reviews = api(host, `repos/${owner}/${repo}/pulls/${number}/reviews`, { paginate: true });
  const pending = reviews.find(
    (r) => r.state === "PENDING" && r.user?.login === login && typeof r.body === "string" && r.body.includes(MARKER_PREFIX),
  );

  let reviewId;
  let mode;
  const alreadyPosted = new Set();
  if (pending) {
    mode = "resumed";
    reviewId = pending.node_id;
    const comments = api(host, `repos/${owner}/${repo}/pulls/${number}/reviews/${pending.id}/comments`, { paginate: true });
    for (const c of comments) {
      const m = parseMarker(c.body);
      if (m) alreadyPosted.add(`${m.findingId}:${m.part}`);
    }
  } else {
    mode = "fallback";
    const created = graphql(host, ADD_EMPTY_REVIEW_MUTATION, { pullRequestId, body });
    reviewId = created.data.addPullRequestReview.pullRequestReview.id;
  }

  let posted = 0;
  const failedThreads = [];
  for (const t of threads) {
    const marker = parseMarker(t.body);
    const key = marker ? `${marker.findingId}:${marker.part}` : null;
    if (key && alreadyPosted.has(key)) {
      posted++;
      continue;
    }
    try {
      graphql(host, ADD_THREAD_MUTATION, {
        pullRequestId,
        pullRequestReviewId: reviewId,
        path: t.path,
        body: t.body,
        line: t.line,
        side: t.side,
        startLine: t.startLine ?? null,
        startSide: t.startSide ?? null,
      });
      posted++;
    } catch {
      failedThreads.push(t);
    }
  }

  if (failedThreads.length > 0) {
    const appendix = failedThreads.map((t) => t.body).join("\n\n");
    graphql(host, UPDATE_REVIEW_MUTATION, {
      pullRequestReviewId: reviewId,
      body: `${body}\n\n### Additional findings (could not be posted inline)\n\n${appendix}`,
    });
  }

  return {
    partial: failedThreads.length > 0,
    report: { mode, posted, demoted: demotedCount + failedThreads.length, failed: failedThreads.length },
  };
}

// ---------------------------------------------------------------------------
// Worktree resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the review's worktree: an explicit `--work-area` override always
 * wins (via its state.json); otherwise prefer `run.properties.worktree`
 * directly (merge-findings.mjs writes this); falling back to
 * `run.properties.workArea`'s state.json for older merged SARIFs that
 * predate that direct property.
 */
export function resolveWorktree(log, workAreaOverride) {
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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sarifPath = args.sarif;
  if (!sarifPath || sarifPath === true) throw new UsageError("--sarif <merged.sarif.json> is required");
  const prUrl = typeof args["pr-url"] === "string" ? args["pr-url"] : undefined;
  const repo = typeof args.repo === "string" ? args.repo : undefined;
  const pr = args.pr != null && args.pr !== true ? Number(args.pr) : undefined;
  const hostArg = typeof args.host === "string" ? args.host : undefined;
  const dryRun = args["dry-run"] === true;
  const forceRecreate = args["force-recreate"] === true;
  const workAreaOverride = typeof args["work-area"] === "string" ? args["work-area"] : undefined;

  let ref;
  try {
    ref = resolvePrRef({ prUrl, repo, pr, hostArg, ghHostEnv: process.env.GH_HOST });
  } catch (e) {
    throw new UsageError(e.message);
  }
  const { host, owner, repo: repoName, number } = ref;

  const log = JSON.parse(fs.readFileSync(sarifPath, "utf8"));
  const run = log.runs?.[0] ?? {};
  const revisionId = run.versionControlProvenance?.[0]?.revisionId;
  if (!revisionId) {
    throw new ValidationError("merged SARIF has no versionControlProvenance; cannot verify the PR's head");
  }

  const prMeta = api(host, `repos/${owner}/${repoName}/pulls/${number}`);
  if (prMeta.head.sha !== revisionId) {
    throw new DriftError(
      `PR head moved since this review was captured: expected ${revisionId}, PR is now at ${prMeta.head.sha}`,
    );
  }

  const files = api(host, `repos/${owner}/${repoName}/pulls/${number}/files`, { paginate: true });
  const worktree = resolveWorktree(log, workAreaOverride);
  const getHeadLines = worktree
    ? (file) => readHeadBlob(worktree, file).lines
    : () => {
        throw new ValidationError(
          "cannot build suggestion fences: the review's worktree could not be resolved " +
            "(run.properties.workArea is missing from the SARIF — pass --work-area explicitly)",
        );
      };

  const plan = buildMutationPlan(log, files, { getHeadLines });
  const githubThreads = plan.threads.map(toGithubThreadInput);
  const body = renderGithubBody(applyDemotions(log, plan.demotions), { worktree });
  const newlyDemoted = plan.demotions.filter((d) => !d.pre);

  if (dryRun) {
    printJson({
      mode: "dry-run",
      pr: { host, owner, repo: repoName, number },
      threads: githubThreads,
      body,
      demotions: plan.demotions.map((d) => ({ findingId: d.result.properties?.findingId, reason: d.reason, pre: d.pre })),
    });
    process.exitCode = newlyDemoted.length > 0 ? EXIT.INVALID : EXIT.OK;
    return;
  }

  // GitHub's REST API only ever surfaces PENDING reviews authored by the
  // caller (another user's draft is invisible here), so `currentLogin` is a
  // sanity check, not a filter: whether a pending review is safe to delete is
  // decided by isPendingReviewFullyOurs (our marker on the review's own body
  // AND every one of its inline comments) — anything PENDING that fails that
  // check (e.g. a manual draft, or our own review with a human's comment
  // added to it) is foreign and must never be touched, unless the caller
  // explicitly opts in via --force-recreate.
  const login = currentLogin(host);
  const reviews = api(host, `repos/${owner}/${repoName}/pulls/${number}/reviews`, { paginate: true });
  const pendingReviews = reviews.filter((r) => r.state === "PENDING");
  const toDelete = forceRecreate ? pendingReviews : [];
  if (!forceRecreate) {
    for (const r of pendingReviews) {
      if (isPendingReviewFullyOurs(host, owner, repoName, number, r)) {
        toDelete.push(r);
      } else {
        throw new ForeignPendingReviewError(
          `a foreign PENDING review (#${r.id} by ${r.user?.login ?? "unknown"}, authenticated as ${login}) already exists on this PR, ` +
            `or has content we cannot verify is entirely ours; refusing to touch it — pass --force-recreate to delete it anyway`,
        );
      }
    }
  }
  for (const r of toDelete) {
    api(host, `repos/${owner}/${repoName}/pulls/${number}/reviews/${r.id}`, { method: "DELETE" });
  }

  const pullRequestId = prMeta.node_id;

  try {
    const created = graphql(host, ADD_REVIEW_MUTATION, { pullRequestId, body, threads: githubThreads });
    printJson({
      mode: "batch",
      posted: githubThreads.length,
      demoted: plan.demotions.length,
      failed: 0,
      reviewUrl: created.data?.addPullRequestReview?.pullRequestReview?.url,
    });
    process.exitCode = EXIT.OK;
  } catch {
    const { partial, report } = runFallback({
      host,
      owner,
      repo: repoName,
      number,
      pullRequestId,
      body,
      threads: githubThreads,
      login,
      demotedCount: plan.demotions.length,
    });
    printJson(report);
    process.exitCode = partial ? EXIT.PARTIAL : EXIT.OK;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(main);
  process.exit(process.exitCode ?? EXIT.OK);
}
