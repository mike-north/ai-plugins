/**
 * Test harness for driving the real `gh-merge` script end to end.
 *
 * - A real git "origin" (bare repo) plus a working clone, so the freshness gate
 *   exercises real `git fetch` / `merge-base` / `merge-tree` / `diff`.
 * - A fake `gh` (selected through the script's documented `GH` override) that
 *   answers `pr view`, `pr checks`, `pr merge`, `repo view`, and `api graphql`
 *   from a per-test fixture file and logs every invocation.
 * - A local HTTP stand-in for the TypeSafe System One endpoint (selected through
 *   `TYPESAFE_BASE_URL`), whose answers are chosen by a per-test handler.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "gh-merge");

export const COPILOT = "copilot-pull-request-reviewer";
export const ERROR_BODY =
  "Copilot encountered an error and was unable to review this pull request. You can try again by re-requesting a review.";

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const fx = JSON.parse(fs.readFileSync(process.env.FAKE_GH_FIXTURE, "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\\n");
const [a, b] = args;
if (a === "pr" && b === "view") { process.stdout.write(JSON.stringify(fx.pr)); process.exit(0); }
if (a === "pr" && b === "checks") { process.exit(fx.checksExit ?? 0); }
if (a === "pr" && b === "merge") { process.stdout.write("merged\\n"); process.exit(0); }
if (a === "repo" && b === "view") { process.stdout.write("fixture-owner/fixture-repo\\n"); process.exit(0); }
if (a === "api" && b === "graphql") {
  if (fx.graphqlExit) { process.stderr.write("graphql failed\\n"); process.exit(fx.graphqlExit); }
  process.stdout.write(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: {
    pageInfo: { hasNextPage: false, endCursor: null }, nodes: fx.threads ?? [] } } } } }));
  process.exit(0);
}
process.stderr.write("fake gh: unhandled " + args.join(" ") + "\\n");
process.exit(1);
`;

/** Create a sandbox directory holding origin, a working clone, and the fake gh. */
export function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "gh-merge-test-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  const gh = join(root, "fake-gh");
  writeFileSync(gh, FAKE_GH);
  chmodSync(gh, 0o755);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", work]);

  const git = (...args) => execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", origin);

  /** Write files (path → content, or null to delete), commit, and return the sha. */
  const commit = (files, message) => {
    for (const [path, content] of Object.entries(files)) {
      const abs = join(work, path);
      if (content === null) {
        git("rm", "-q", path);
        continue;
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      git("add", path);
    }
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };

  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { root, origin, work, gh, git, commit, cleanup };
}

/**
 * The app file both branches start from. `greet` (line 6) and the file's end are
 * far enough apart that edits to each land in separate diff hunks.
 */
export const APP_V1 = [
  "export function add(a, b) {",
  "  return a + b;",
  "}",
  "",
  "export function greet(name) {",
  "  return 'hello';",
  "}",
  "",
  "export function sub(a, b) {",
  "  return a - b;",
  "}",
  "",
  "export function mul(a, b) {",
  "  return a * b;",
  "}",
  "",
  "export function farewell(name) {",
  "  return 'bye ' + name;",
  "}",
  "",
].join("\n");

/** Appended by tests that add behaviour nobody asked for. */
export const NEW_FEATURE_FN = [
  "",
  "export function shout(name) {",
  "  // NEW_FEATURE: nobody asked for this",
  "  return name.toUpperCase();",
  "}",
  "",
].join("\n");

/**
 * The common starting point: `main` with src/app.js + README, and a `feat`
 * branch whose one commit (R) was reviewed. Returns the shas.
 */
export function seedReviewedBranch(sb) {
  const base = sb.commit({ "src/app.js": APP_V1, "README.md": "# app\n" }, "initial");
  sb.git("push", "-q", "origin", "main");
  sb.git("checkout", "-q", "-b", "feat");
  const reviewed = sb.commit(
    { "src/app.js": APP_V1.replace("return 'hello';", "return 'hello ' + nam;") },
    "greet by name",
  );
  sb.git("push", "-q", "origin", "feat");
  return { base, reviewed };
}

/** A Copilot review thread on the reviewed commit, in the GraphQL node shape. */
export const TYPO_THREAD = {
  isResolved: true,
  isOutdated: true,
  path: "src/app.js",
  line: 6,
  comments: {
    nodes: [
      { author: { login: COPILOT }, body: "`nam` is undefined here — did you mean `name`?" },
      { author: { login: "mike-north" }, body: "Good catch, fixed." },
    ],
  },
};

/** A `gh pr view --json …` payload. */
export function prView({ head, baseOid, reviews, overrides = {} }) {
  return {
    number: 7,
    title: "Greet by name",
    state: "OPEN",
    isDraft: false,
    headRefName: "feat",
    headRefOid: head,
    baseRefName: "main",
    baseRefOid: baseOid,
    reviews,
    ...overrides,
  };
}

export const review = (commit, { body = "Reviewed.", state = "COMMENTED", login = COPILOT, at } = {}) => ({
  author: { login },
  state,
  body,
  submittedAt: at ?? "2026-09-01T00:00:00Z",
  commit: commit === null ? null : { oid: commit },
});

/**
 * Start a stand-in TypeSafe endpoint. `handler(requestBody)` returns
 * `{ status, body }`; every request body is recorded in `requests`.
 */
export async function startTypeSafeStub(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
      requests.push({ url: req.url, auth: req.headers.authorization, body: parsed });
      const { status, body } = handler(parsed);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * Default stub judgement, keyed off markers in the hunk text so each test's
 * commit content decides the model's answer:
 *   NEW_FEATURE → a confident "new change";   SCOPE_CREEP → thread_1 but beyond scope;
 *   UNSURE      → a spread, low-confidence choice; otherwise → confidently thread_1.
 */
export function markerJudge(body) {
  const patch = body?.state?.change?.patch ?? "";
  const keys = Object.keys(body.questions.addresses.criteria);
  const dist = (top, p) => {
    const rest = (1 - p) / (keys.length - 1);
    return Object.fromEntries(keys.map((k) => [k, k === top ? p : rest]));
  };
  let addresses;
  let beyond = 0.05;
  if (patch.includes("NEW_FEATURE")) {
    addresses = { type: "choice", choice: "new_change", probabilities: dist("new_change", 0.9), confidence: 0.85 };
    beyond = 0.9;
  } else if (patch.includes("UNSURE")) {
    addresses = { type: "choice", choice: "thread_1", probabilities: dist("thread_1", 0.4), confidence: 0.2 };
  } else {
    addresses = { type: "choice", choice: "thread_1", probabilities: dist("thread_1", 0.94), confidence: 0.9 };
    if (patch.includes("SCOPE_CREEP")) beyond = 0.85;
  }
  return {
    status: 200,
    body: {
      model: "jev-1.13.0",
      answers: { addresses, beyond: { type: "noul", noul: beyond } },
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  };
}

/**
 * Run the real gh-merge from the sandbox's working clone.
 * Resolves `{ code, stdout, stderr, ghCalls }` — never rejects on a non-zero exit.
 */
export function runGhMerge(sb, { fixture, args = ["7"], env = {}, cwd = sb.work }) {
  const fixturePath = join(sb.root, "fixture.json");
  const logPath = join(sb.root, "gh-calls.log");
  writeFileSync(fixturePath, JSON.stringify(fixture));
  writeFileSync(logPath, "");
  const fullEnv = {
    ...process.env,
    GH: sb.gh,
    FAKE_GH_FIXTURE: fixturePath,
    FAKE_GH_LOG: logPath,
    // Never let a real key or endpoint from the developer's shell leak in.
    TYPESAFE_API_KEY: "stub-key",
    TYPESAFE_BASE_URL: "http://127.0.0.1:9",
    ...env,
  };
  for (const [k, v] of Object.entries(fullEnv)) if (v === undefined) delete fullEnv[k];
  return new Promise((resolve) => {
    execFile("bash", [SCRIPT, ...args], { cwd, env: fullEnv, encoding: "utf8" }, (err, stdout, stderr) => {
      const ghCalls = existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : [];
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr, ghCalls });
    });
  });
}

/** Whether the fake gh saw a `pr merge` call. */
export const merged = (r) => r.ghCalls.some((c) => c[0] === "pr" && c[1] === "merge");
