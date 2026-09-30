#!/usr/bin/env node
// @ts-check
/**
 * review-freshness-gate — gh-merge's review-freshness guard (internal helper).
 *
 * gh-merge calls this only when the latest successful matching-reviewer review
 * was on commit R and the PR head H ≠ R. It decides whether H still stands on
 * that review:
 *
 *   1. Re-apply the reviewed change (base_R..R) onto H's base with
 *      `git merge-tree`, and diff the result against H. Rebases and merges from
 *      the base branch therefore contribute nothing; only the PR's own post-
 *      review edits remain.
 *   2. Deterministically set aside edits in generated/mechanical paths, and
 *      deterministically flag what cannot be judged (binary files, paths where
 *      the reviewed change conflicted with the new base, oversized diffs).
 *   3. Judge each remaining hunk with TypeSafe (one System One request per hunk,
 *      state = the hunk, the reviewer's review threads, and the push's other
 *      hunks as context) and apply the asymmetric policy in `review-freshness.mjs`.
 *
 * Usage (from inside a clone of the PR's repository):
 *   review-freshness-gate.mjs --pr N --reviewed R --head H --base B [--reviewer-re RE]
 *
 * Output: a human-readable verdict report on stdout.
 * Exit codes: 0 covered (no fresh review needed); 3 a fresh review is needed;
 *             1 the check itself could not be completed (message on stderr).
 * gh-merge refuses the merge on anything but 0 — the guard fails closed.
 *
 * Env:
 *   TYPESAFE_API_KEY       required only when a hunk needs a model judgement
 *   TYPESAFE_BASE_URL      API root (default https://api.typesafe.ai)
 *   PLEF_TYPESAFE_MAX_RETRIES  retries for transient API errors (default 2)
 *   PLEF_FRESHNESS_IGNORE  comma list of generated/mechanical path patterns (replaces defaults)
 *   PLEF_GIT_REMOTE        remote to fetch missing commits from (default "origin")
 *   GH                     gh binary (default "gh")
 */

import { spawnSync } from "node:child_process";
import {
  LIMITS,
  MODEL,
  buildJudgementRequest,
  estimateTokens,
  evaluateHunk,
  findCatchAllPattern,
  isIgnoredPath,
  parseFilePatch,
  parseIgnorePatterns,
} from "./review-freshness.mjs";
import { createSystemOneClient } from "./typesafe-client.mjs";

const ENV = process.env;
const GH = ENV.GH || "gh";
const REMOTE = ENV.PLEF_GIT_REMOTE || "origin";
const CONCURRENCY = 4;

/** A failure to complete the check (exit 1). Never a verdict. */
class GateError extends Error {}

/**
 * Thrown once the verdict is written, to unwind `main` without `process.exit`
 * (which can truncate stdout on platforms where pipe writes are asynchronous).
 */
class VerdictReached {
  constructor(/** @type {number} */ code) {
    this.code = code;
  }
}

/**
 * Run a command; return stdout. Throws GateError (with `what` and stderr) on failure,
 * unless `okCodes` admits the exit status.
 * @param {string} cmd @param {string[]} args
 * @param {{ what: string, okCodes?: number[], env?: NodeJS.ProcessEnv }} opts
 */
function run(cmd, args, { what, okCodes = [0], env }) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...ENV, GIT_LITERAL_PATHSPECS: "1", ...env },
  });
  if (r.error) throw new GateError(`${what}: ${r.error.message}`);
  if (!okCodes.includes(r.status ?? -1)) {
    const detail = (r.stderr || r.stdout || "").trim().split("\n").slice(0, 4).join(" / ");
    throw new GateError(`${what}${detail ? `: ${detail}` : ""}`);
  }
  return { stdout: r.stdout, status: r.status ?? 0 };
}

const git = (/** @type {string[]} */ args, /** @type {string} */ what, okCodes = [0]) =>
  run("git", ["-c", "core.quotePath=false", ...args], { what, okCodes });

const short = (/** @type {string} */ sha) => sha.slice(0, 7);

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k?.startsWith("--") || v === undefined) throw new GateError(`bad arguments: ${argv.join(" ")}`);
    out[k.slice(2)] = v;
  }
  for (const k of ["pr", "reviewed", "head", "base"]) if (!out[k]) throw new GateError(`missing --${k}`);
  return {
    pr: out.pr,
    reviewed: out.reviewed,
    head: out.head,
    base: out.base,
    reviewerRe: out["reviewer-re"] || "copilot",
  };
}

/** Make sure every commit is present locally, fetching the missing ones by SHA. */
function ensureCommits(/** @type {string[]} */ shas) {
  const has = (/** @type {string} */ sha) =>
    spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" }).status === 0;
  const missing = [...new Set(shas)].filter((s) => !has(s));
  if (missing.length === 0) return;
  git(
    ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", REMOTE, ...missing],
    `could not fetch commit(s) ${missing.map(short).join(", ")} from remote "${REMOTE}" (set PLEF_GIT_REMOTE if the PR's repository is another remote)`,
  );
  const still = missing.filter((s) => !has(s));
  if (still.length) throw new GateError(`could not fetch commit(s) ${still.map(short).join(", ")} from remote "${REMOTE}"`);
}

/**
 * Parse `git diff -z --name-status` output.
 * @returns {{ status: string, path: string, oldPath: string | null }[]}
 */
function parseNameStatus(/** @type {string} */ out) {
  const parts = out.split("\0");
  const files = [];
  for (let i = 0; i < parts.length && parts[i] !== ""; ) {
    const status = parts[i];
    if (status.startsWith("R") || status.startsWith("C")) {
      files.push({ status, oldPath: parts[i + 1], path: parts[i + 2] });
      i += 3;
    } else {
      files.push({ status, oldPath: null, path: parts[i + 1] });
      i += 2;
    }
  }
  return files;
}

/**
 * Fetch the review threads started by the matching reviewer.
 * @returns {{ threads: import("./review-freshness.mjs").ReviewThread[], truncated: boolean }}
 */
function fetchReviewThreads(/** @type {string} */ pr, /** @type {RegExp} */ reviewer) {
  const nameWithOwner = run(GH, ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
    what: "could not resolve the repository with gh",
  }).stdout.trim();
  const [owner, repo] = nameWithOwner.split("/");
  if (!owner || !repo) throw new GateError(`could not resolve the repository with gh (got "${nameWithOwner}")`);
  const query = `query($owner:String!, $repo:String!, $pr:Int!) {
    repository(owner:$owner, name:$repo) { pullRequest(number:$pr) {
      reviewThreads(first:${LIMITS.maxThreads}) {
        pageInfo { hasNextPage }
        nodes { isResolved path line originalLine
          comments(first:${LIMITS.maxCommentsPerThread}) { nodes { author { login } body } } } } } } }`;
  const raw = run(GH, ["api", "graphql", "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `pr=${pr}`, "-f", `query=${query}`], {
    what: "could not read the PR's review threads",
  }).stdout;
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new GateError("could not read the PR's review threads: gh returned non-JSON");
  }
  const rt = data?.data?.repository?.pullRequest?.reviewThreads;
  if (!rt || !Array.isArray(rt.nodes)) throw new GateError("could not read the PR's review threads: unexpected response shape");
  const threads = rt.nodes
    .filter((/** @type {any} */ n) => reviewer.test(n?.comments?.nodes?.[0]?.author?.login ?? ""))
    .map((/** @type {any} */ n, /** @type {number} */ i) => ({
      id: `thread_${i + 1}`,
      path: String(n.path ?? ""),
      line: n.line ?? n.originalLine ?? null,
      resolved: Boolean(n.isResolved),
      comments: n.comments.nodes.map((/** @type {any} */ c) => ({
        author: String(c?.author?.login ?? "unknown"),
        body: String(c?.body ?? ""),
      })),
    }));
  return { threads, truncated: Boolean(rt.pageInfo?.hasNextPage) };
}

/** Run `fn` over `items` with at most `limit` in flight; rejects on the first failure. */
async function mapLimit(/** @type {any[]} */ items, /** @type {number} */ limit, /** @type {(x: any) => Promise<any>} */ fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ignore = parseIgnorePatterns(ENV.PLEF_FRESHNESS_IGNORE);
  const catchAll = findCatchAllPattern(ignore);
  if (catchAll) {
    throw new GateError(
      `PLEF_FRESHNESS_IGNORE pattern "${catchAll}" would exempt ordinary source files everywhere; name the generated paths instead`,
    );
  }
  let reviewerRe;
  try {
    reviewerRe = new RegExp(args.reviewerRe, "i");
  } catch {
    throw new GateError(`invalid reviewer pattern /${args.reviewerRe}/`);
  }

  if (spawnSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" }).status !== 0) {
    throw new GateError(
      "the freshness check compares commits with git: run gh-merge from inside a local clone of the PR's repository",
    );
  }
  ensureCommits([args.reviewed, args.head, args.base]);

  const baseR = git(["merge-base", args.reviewed, args.base], "could not find where the reviewed commit forked from the base").stdout.trim();
  const baseH = git(["merge-base", args.head, args.base], "could not find where the head forked from the base").stdout.trim();

  // The reviewed change, transplanted onto the head's base.
  const mt = git(
    ["merge-tree", "--write-tree", "--name-only", "--no-messages", `--merge-base=${baseR}`, baseH, args.reviewed],
    "could not re-apply the reviewed change onto the current base",
    [0, 1],
  );
  const [tree, ...conflictLines] = mt.stdout.split("\n").filter(Boolean);
  const conflicted = new Set(mt.status === 1 ? conflictLines : []);

  const changed = parseNameStatus(
    git(["diff", "-z", "--name-status", "--find-renames", tree, args.head], "could not diff the head against the reviewed change").stdout,
  );

  const lines = [
    `review freshness: reviewed ${short(args.reviewed)} → head ${short(args.head)} (base ${short(args.base)})`,
  ];
  /** @type {{ label: string, reasons: string[] }[]} */
  const deterministic = [];
  /** @type {string[]} */
  const ignoredPaths = [];
  /** @type {import("./review-freshness.mjs").FileHunk[]} */
  const toJudge = [];

  for (const path of conflicted) {
    if (isIgnoredPath(path, ignore)) ignoredPaths.push(path);
    else
      deterministic.push({
        label: path,
        reasons: ["the reviewed change conflicts with the new base here, so the resolution was never reviewed"],
      });
  }
  for (const f of changed) {
    if (conflicted.has(f.path)) continue;
    const paths = f.oldPath ? [f.oldPath, f.path] : [f.path];
    if (paths.every((p) => isIgnoredPath(p, ignore))) {
      ignoredPaths.push(f.path);
      continue;
    }
    const patch = git(
      ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--find-renames", "-U3", tree, args.head, "--", ...paths],
      `could not diff ${f.path}`,
    ).stdout;
    const parsed = parseFilePatch(patch);
    if (parsed.binary) {
      deterministic.push({ label: f.path, reasons: ["binary change — its content cannot be judged"] });
      continue;
    }
    const file = f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
    if (parsed.hunks.length === 0) {
      // A header-only change (rename, mode change, empty file): judge its header.
      const header = patch
        .split("\n")
        .filter((l) => l && !l.startsWith("diff --git") && !l.startsWith("index "))
        .join("\n");
      toJudge.push({ file, header: "(file-level change)", patch: header });
    } else for (const h of parsed.hunks) toJudge.push({ file, ...h });
  }

  if (ignoredPaths.length) lines.push(`  set aside (generated/mechanical paths): ${ignoredPaths.join(", ")}`);
  if (changed.length === 0 && conflicted.size === 0) {
    lines.push("  no edits beyond the reviewed change (rebase or base-branch merge only)");
  }
  for (const d of deterministic) lines.push(`  ${d.label} — NEEDS REVIEW: ${d.reasons.join("; ")}`);

  const finish = (/** @type {number} */ needs, /** @type {number} */ total) => {
    lines.push(
      needs === 0
        ? "verdict: covered — every edit since the review is rebase-only, generated, or answers review feedback"
        : `verdict: NEEDS REVIEW — ${needs} of ${total} change(s) since the review are not covered by it`,
    );
    process.stdout.write(lines.join("\n") + "\n");
    throw new VerdictReached(needs === 0 ? 0 : 3);
  };

  if (toJudge.length > LIMITS.maxHunks) {
    lines.push(`  ${toJudge.length} hunks — NEEDS REVIEW: too large to judge (more than ${LIMITS.maxHunks} hunks since the review)`);
    finish(1, 1);
  }
  if (deterministic.length) {
    if (toJudge.length) lines.push(`  (${toJudge.length} other hunk(s) not judged: a fresh review is already required)`);
    finish(deterministic.length, deterministic.length + toJudge.length);
  }
  if (toJudge.length === 0) finish(0, 0);

  if (!ENV.TYPESAFE_API_KEY) {
    throw new GateError(
      "TYPESAFE_API_KEY is not set — judging the post-review edits needs it; start the agent session through your secrets launcher so the key is in the environment",
    );
  }
  const maxRetries = ENV.PLEF_TYPESAFE_MAX_RETRIES === undefined ? 2 : Number(ENV.PLEF_TYPESAFE_MAX_RETRIES);
  const client = createSystemOneClient({
    apiKey: ENV.TYPESAFE_API_KEY,
    baseUrl: ENV.TYPESAFE_BASE_URL,
    model: MODEL,
    maxRetries: Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : 2,
  });

  const { threads, truncated } = fetchReviewThreads(args.pr, reviewerRe);
  if (truncated) lines.push(`  note: only the first ${LIMITS.maxThreads} review threads were considered`);

  /** The push's other hunks, as context: full text when small, else just their headers. */
  const siblingsOf = (/** @type {import("./review-freshness.mjs").FileHunk} */ hunk) => {
    const others = toJudge.filter((h) => h !== hunk);
    const size = others.reduce((n, h) => n + h.patch.length, 0);
    return others.map((h) => ({ file: h.file, patch: size <= LIMITS.maxSiblingChars ? h.patch : h.header }));
  };

  const judged = await mapLimit(toJudge, CONCURRENCY, async (hunk) => {
    const request = buildJudgementRequest(hunk, threads, siblingsOf(hunk));
    const longestQuestion = Math.max(...Object.values(request.questions).map((q) => JSON.stringify(q).length));
    if (estimateTokens(JSON.stringify(request.state)) + estimateTokens("x".repeat(longestQuestion)) > LIMITS.maxRequestTokens) {
      return { hunk, oversized: true };
    }
    const answers = await client.ask(request);
    return { hunk, judgement: evaluateHunk(/** @type {any} */ (answers)) };
  });

  const threadLabel = (/** @type {string} */ id) => {
    const t = threads.find((x) => x.id === id);
    return t ? ` (${t.path}${t.line == null ? "" : `:${t.line}`})` : "";
  };
  let needs = 0;
  for (const { hunk, judgement, oversized } of judged) {
    const where = `${hunk.file} ${hunk.header}`;
    if (oversized) {
      needs++;
      lines.push(`  ${where} — NEEDS REVIEW: too large to judge in one request`);
      continue;
    }
    const j = /** @type {import("./review-freshness.mjs").HunkJudgement} */ (judgement);
    const scores =
      `addresses ${j.addresses}${threadLabel(j.addresses)} · confidence ${j.confidence.toFixed(2)} · ` +
      `p(new change) ${j.pNew === undefined ? "?" : j.pNew.toFixed(2)} · beyond ${j.beyond.toFixed(2)}` +
      `${j.mechanical === undefined ? "" : ` · mechanical ${j.mechanical.toFixed(2)}`}`;
    if (j.verdict === "covered") lines.push(`  ${where} — covered: ${scores}`);
    else {
      needs++;
      lines.push(`  ${where} — NEEDS REVIEW: ${j.reasons.join("; ")} [${scores}]`);
    }
  }
  finish(needs, judged.length);
}

main().then(
  () => {
    // Every path through main ends in a verdict; reaching here is a bug — fail closed.
    process.stderr.write("review-freshness-gate ended without a verdict\n");
    process.exitCode = 1;
  },
  (err) => {
    if (err instanceof VerdictReached) {
      process.exitCode = err.code;
      return;
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
