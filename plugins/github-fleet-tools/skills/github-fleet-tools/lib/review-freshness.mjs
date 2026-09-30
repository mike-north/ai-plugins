// @ts-check
/**
 * Review freshness: the pure (I/O-free) half of gh-merge's review-freshness guard.
 *
 * The question the guard answers: a matching reviewer (Copilot by default)
 * reviewed commit R; the PR head is now H ≠ R. Does H still stand on that
 * review, or does it need a fresh one? This module owns the parts of that
 * decision that are data and policy rather than plumbing:
 *
 *   - which paths are exempt as generated/mechanical output (`isIgnoredPath`);
 *   - how a per-file unified diff splits into independently judged hunks
 *     (`parseFilePatch`);
 *   - the TypeSafe System One request asked about each hunk
 *     (`buildJudgementRequest`): a Choice ("which review thread does this change
 *     carry out?", plus `mechanical` and `new_change`) and a Noul ("does it go
 *     beyond what the feedback asked for?"), both over the same state;
 *   - the asymmetric policy that turns those answers into a per-hunk verdict
 *     (`evaluateHunk`): a hunk is `covered` only when every signal confidently
 *     says so; any doubt means `needs_review`.
 *
 * Invariant: nothing here can produce `covered` from missing or ambiguous data.
 * The thresholds are calibrated against a pinned model version (`MODEL`); a
 * model change needs re-calibration, not a silent swap.
 *
 * @see https://docs.typesafe.ai/primitives/choice.md
 * @see https://docs.typesafe.ai/primitives/noul.md
 * @see https://docs.typesafe.ai/confidence.md
 */

/** The model the thresholds were calibrated against. Pinned, never "latest". */
export const MODEL = "jev-1.13.0";

/**
 * Policy thresholds. A hunk is `covered` only if ALL hold:
 *   - the Choice's top answer is a review thread or `mechanical` (not `new_change`);
 *   - Choice confidence ≥ `minConfidence`;
 *   - P(`new_change`) < `maxNewChangeProbability` (a real minority chance that the
 *     edit is new work is enough to ask for a review);
 *   - the "goes beyond the feedback" Noul < `maxBeyond`.
 * See SKILL.md "Review freshness → Calibration" for the evidence behind the values.
 */
export const THRESHOLDS = Object.freeze({
  minConfidence: 0.6,
  maxNewChangeProbability: 0.2,
  maxBeyond: 0.5,
});

/**
 * Size limits. Beyond them the guard refuses rather than judging part of a
 * change. `maxRequestTokens` keeps each request well inside the model's
 * documented 32k-token budget for state plus the longest question.
 */
export const LIMITS = Object.freeze({
  maxHunks: 40,
  maxThreads: 100,
  maxCommentsPerThread: 6,
  maxCommentChars: 1500,
  maxRequestTokens: 24000,
});

/**
 * Paths whose post-review changes are generated or mechanical by convention and
 * never need a reviewer: API Extractor reports, generated API docs, changesets,
 * and package-manager lockfiles. Override with `PLEF_FRESHNESS_IGNORE`.
 */
export const DEFAULT_IGNORE_PATTERNS = Object.freeze([
  "api-report/",
  "docs/api/",
  ".changeset/",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "go.sum",
]);

/**
 * Parse a comma-separated ignore override. Unset or blank keeps the defaults;
 * anything else REPLACES them (so a repo can also narrow the exemptions).
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parseIgnorePatterns(raw) {
  if (raw === undefined || raw.trim() === "") return [...DEFAULT_IGNORE_PATTERNS];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Translate a glob (`**`, `*`, `?`) into a regex source; `/` is the only separator. */
function globSource(/** @type {string} */ glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

/**
 * Whether `path` (repo-relative, `/`-separated) matches any pattern:
 *   - `dir/` (trailing slash) — anything under a directory of that name, at any depth;
 *   - `name` (no slash) — a basename glob, at any depth (e.g. `*.snap`, `yarn.lock`);
 *   - `a/b/*.ts` (inner slash) — a glob anchored at the repo root; `**` spans directories.
 * @param {string} path
 * @param {readonly string[]} patterns
 */
export function isIgnoredPath(path, patterns) {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return patterns.some((p) => {
    if (p.endsWith("/")) return new RegExp(`(?:^|/)${globSource(p.slice(0, -1))}/`).test(path);
    if (!p.includes("/")) return new RegExp(`^${globSource(p)}$`).test(basename);
    return new RegExp(`^${globSource(p.replace(/^\//, ""))}$`).test(path);
  });
}

/**
 * Patterns that would exempt ordinary source everywhere (`*`, `**`, `*\/`, …).
 * The ignore override exists to name generated output, not to switch the guard
 * off, so such a pattern is refused. Returns the first offender, if any.
 * @param {readonly string[]} patterns
 * @returns {string | undefined}
 */
export function findCatchAllPattern(patterns) {
  const probes = ["src/index.ts", "lib/deep/module.py", "test/app.test.js"];
  return patterns.find((p) => probes.every((probe) => isIgnoredPath(probe, [p])));
}

/**
 * @typedef {{ header: string, patch: string }} Hunk
 * @typedef {Hunk & { file: string }} FileHunk
 */

/**
 * Split one file's `git diff` output into its `@@` hunks (each keeps its header
 * line). Binary changes have no reviewable text and are flagged instead.
 * @param {string} filePatch
 * @returns {{ binary: boolean, hunks: Hunk[] }}
 */
export function parseFilePatch(filePatch) {
  const lines = filePatch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const binary = lines.some((l) => l.startsWith("Binary files ") || l === "GIT binary patch");
  /** @type {Hunk[]} */
  const hunks = [];
  /** @type {string[] | null} */
  let current = null;
  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      if (current) hunks.push({ header: current[0], patch: current.join("\n") });
      current = [line];
    } else if (current) current.push(line);
  }
  if (current) hunks.push({ header: current[0], patch: current.join("\n") });
  return { binary, hunks };
}

/** Conservative token estimate (≈3 characters per token) for budget checks. */
export const estimateTokens = (/** @type {string} */ text) => Math.ceil(text.length / 3);

/**
 * A review thread as the judgement sees it. `id` is the option key the Choice
 * offers (`thread_1`, …); `comments` are in thread order, the first being the
 * reviewer's request and the rest the discussion.
 * @typedef {{ id: string, path: string, line: number | null, resolved: boolean,
 *   comments: { author: string, body: string }[] }} ReviewThread
 */

const truncate = (/** @type {string} */ s, /** @type {number} */ n) =>
  s.length > n ? `${s.slice(0, n)}… [truncated]` : s;

const CONTEXT =
  "A code reviewer reviewed an earlier commit of a pull request. Afterwards the author pushed more " +
  "edits. `change` is one hunk (unified diff: `-` lines removed, `+` lines added, other lines " +
  "unchanged context) of those later edits, in file `change.file`. `review_threads` lists the " +
  "reviewer's feedback threads: where each was left (`file`, `line`) and its comments, the first " +
  "being the reviewer's request and any later ones the discussion.";

/**
 * Build the System One request for one hunk: shared state (the hunk and every
 * review thread) with two independent questions over it.
 * @param {FileHunk} hunk
 * @param {readonly ReviewThread[]} threads
 */
export function buildJudgementRequest(hunk, threads) {
  const reviewThreads = threads.map((t) => ({
    thread: t.id,
    file: t.path,
    line: t.line,
    resolved: t.resolved,
    comments: t.comments
      .slice(0, LIMITS.maxCommentsPerThread)
      .map((c) => ({ author: c.author, body: truncate(c.body, LIMITS.maxCommentChars) })),
  }));

  /** @type {Record<string, unknown>} */
  const options = {};
  for (const t of threads) {
    options[t.id] = {
      what: `The change carries out the feedback in review thread ${t.id}, or is its direct, minimal follow-through (such as a test or doc update for exactly that fix).`,
      feedback_location: `${t.path}${t.line == null ? "" : ` line ${t.line}`}`,
      feedback: truncate(t.comments[0]?.body ?? "", 300),
    };
  }
  options.mechanical = {
    what: "A change with no effect on behavior or meaning that any reviewer would need to see: formatting or whitespace, import ordering, regenerated or lock files, version bumps, typo fixes in comments or prose.",
    not_for:
      "Any change to logic, control flow, values, error handling, public API, test assertions, or what documentation says.",
  };
  options.new_change = {
    what: "The change is not a response to any listed review thread: new behavior or features, bug fixes or refactors no thread asked for, tests or documentation for such work.",
    not_for: "Edits that carry out a listed thread's feedback, or purely mechanical edits.",
  };

  return {
    state: { change: { file: hunk.file, patch: hunk.patch }, review_threads: reviewThreads },
    questions: {
      addresses: {
        type: /** @type {const} */ ("choice"),
        instructions: {
          context: CONTEXT,
          question:
            "Which review thread's feedback does `change` carry out? Answer `mechanical` if it changes no behavior or meaning, or `new_change` if it responds to none of the `review_threads`.",
        },
        criteria: options,
      },
      beyond: {
        type: /** @type {const} */ ("noul"),
        instructions: {
          context: CONTEXT,
          question:
            "Does `change` do more than any of the `review_threads` asked for — adding behavior, features, or edits that no review comment called for?",
        },
        criteria: {
          true: "The change includes edits no review comment requested: new behavior, extra refactoring, unrelated fixes, or new functionality — or it responds to no review thread at all.",
          false:
            "Every edit in the change is what a review comment asked for, a direct minimal consequence of it (such as updating a test or doc to match the requested fix), or purely mechanical.",
        },
      },
    },
  };
}

/**
 * @typedef {{ verdict: "covered" | "needs_review", addresses: string, confidence: number,
 *   pNew: number | undefined, beyond: number, reasons: string[] }} HunkJudgement
 */

/**
 * Apply the asymmetric policy to one hunk's answers.
 * @param {{ addresses: { choice: string, probabilities: Record<string, number>, confidence: number },
 *   beyond: { noul: number } }} answers
 * @returns {HunkJudgement}
 */
export function evaluateHunk(answers) {
  const { choice, probabilities, confidence } = answers.addresses;
  const beyond = answers.beyond.noul;
  const pNew = probabilities.new_change;
  const t = THRESHOLDS;
  /** @type {string[]} */
  const reasons = [];
  if (choice === "new_change") reasons.push("classified as a new change, not a response to review feedback");
  if (pNew === undefined) reasons.push("no probability reported for a new change");
  else if (pNew >= t.maxNewChangeProbability && choice !== "new_change")
    reasons.push(`possibly a new change (p ${pNew.toFixed(2)} ≥ ${t.maxNewChangeProbability})`);
  if (confidence < t.minConfidence)
    reasons.push(`low confidence in which feedback it answers (${confidence.toFixed(2)} < ${t.minConfidence})`);
  if (beyond >= t.maxBeyond)
    reasons.push(`goes beyond what the review feedback asked for (${beyond.toFixed(2)} ≥ ${t.maxBeyond})`);
  return {
    verdict: reasons.length === 0 ? "covered" : "needs_review",
    addresses: choice,
    confidence,
    pNew,
    beyond,
    reasons,
  };
}
