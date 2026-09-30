/**
 * Integration tests for `gh-merge`, driving the real script with a fake `gh`
 * (via the documented `GH` override), real git repositories, and a local
 * stand-in for the TypeSafe System One endpoint (via `TYPESAFE_BASE_URL`).
 *
 * The behaviour under test is the documented guard contract (SKILL.md,
 * "gh-merge"): a merge happens only when every guard passes, and every guard
 * that cannot be verified refuses with exit 3 — including the review-freshness
 * guard, which fails closed on a missing key, an API error, or an oversized diff.
 *
 * @see https://cli.github.com/manual/gh_pr_view
 * @see https://cli.github.com/manual/gh_pr_merge
 * @see https://docs.typesafe.ai/api.md
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_V1,
  COPILOT,
  ERROR_BODY,
  NEW_FEATURE_FN,
  TYPO_THREAD,
  makeSandbox,
  markerJudge,
  merged,
  prView,
  review,
  runGhMerge,
  SCRIPT,
  seedReviewedBranch,
  startTypeSafeStub,
} from "../test-support/gh-merge-harness.mjs";

// Each case spins up git repos, a node gh stub, and (sometimes) retry backoff.
vi.setConfig({ testTimeout: 30000 });

const FIXED_GREET = APP_V1.replace("return 'hello';", "return 'hello ' + name;");

let sb;
let stub;

beforeEach(async () => {
  sb = makeSandbox();
  stub = await startTypeSafeStub(markerJudge);
});

afterEach(async () => {
  await stub.close();
  sb.cleanup();
});

/** Fixture for a PR whose head is `head`, reviewed (successfully) at `reviewed`. */
const fixtureFor = ({ head, reviewed, baseOid, reviews, threads = [TYPO_THREAD], ...rest }) => ({
  pr: prView({ head, baseOid, reviews: reviews ?? [review(reviewed)] }),
  threads,
  ...rest,
});

const withStub = (env = {}) => ({ TYPESAFE_BASE_URL: stub.url, ...env });

describe("existing guards (regression)", () => {
  it("rejects a non-numeric PR number with exit 2", async () => {
    const r = await runGhMerge(sb, { fixture: {}, args: ["abc"] });
    expect(r.code).toBe(2);
  });

  it("refuses a draft PR", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const fx = fixtureFor({ head: reviewed, reviewed, baseOid: base });
    fx.pr.isDraft = true;
    const r = await runGhMerge(sb, { fixture: fx });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/draft/);
    expect(merged(r)).toBe(false);
  });

  it("refuses a release PR", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const fx = fixtureFor({ head: reviewed, reviewed, baseOid: base });
    fx.pr.title = "Release packages";
    const r = await runGhMerge(sb, { fixture: fx });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/release/);
  });

  it("refuses when no matching reviewer has reviewed", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const fx = fixtureFor({
      head: reviewed,
      reviewed,
      baseOid: base,
      reviews: [review(reviewed, { login: "someone-else" })],
    });
    const r = await runGhMerge(sb, { fixture: fx });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/no review from a matching reviewer/);
  });

  it("refuses when the latest matching review requests changes", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const fx = fixtureFor({
      head: reviewed,
      reviewed,
      baseOid: base,
      reviews: [review(reviewed, { state: "CHANGES_REQUESTED" })],
    });
    const r = await runGhMerge(sb, { fixture: fx });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/requests changes/);
  });

  it("refuses when required checks are not clean", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const fx = { ...fixtureFor({ head: reviewed, reviewed, baseOid: base }), checksExit: 1 };
    const r = await runGhMerge(sb, { fixture: fx });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/required status checks/);
  });
});

describe("review covers the current head", () => {
  it("merges when the latest successful review is on the head, binding the merge to that head", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head: reviewed, reviewed, baseOid: base }),
      env: { TYPESAFE_API_KEY: undefined },
    });
    expect(r.code).toBe(0);
    expect(merged(r)).toBe(true);
    const mergeCall = r.ghCalls.find((c) => c[0] === "pr" && c[1] === "merge");
    expect(mergeCall).toEqual(["pr", "merge", "7", "--squash", "--match-head-commit", reviewed]);
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses when a review's commit is unknown", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head: reviewed, reviewed, baseOid: base, reviews: [review(null)] }),
    });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/which commit/);
  });
});

describe("errored Copilot reviews do not count (bug: an error notice passed as a review)", () => {
  it("refuses when the only matching reviews are error notices", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({
        head: reviewed,
        reviewed,
        baseOid: base,
        reviews: [review(reviewed, { body: ERROR_BODY }), review(reviewed, { body: ERROR_BODY })],
      }),
    });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/errored/);
    expect(r.stderr).toContain("gh pr edit 7 --add-reviewer @copilot");
    expect(merged(r)).toBe(false);
  });

  it("a later error notice on the head does not make the head count as reviewed", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit({ "src/app.js": FIXED_GREET + NEW_FEATURE_FN }, "fix + extra");
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({
        head,
        reviewed,
        baseOid: base,
        reviews: [
          review(reviewed, { at: "2026-09-01T00:00:00Z" }),
          review(head, { body: ERROR_BODY, at: "2026-09-02T00:00:00Z" }),
        ],
      }),
      env: withStub(),
    });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/fresh Copilot review is needed/);
    expect(merged(r)).toBe(false);
  });

  it("an error notice after a successful review of the head does not block the merge", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({
        head: reviewed,
        reviewed,
        baseOid: base,
        reviews: [
          review(reviewed, { at: "2026-09-01T00:00:00Z" }),
          review(reviewed, { body: ERROR_BODY, at: "2026-09-02T00:00:00Z" }),
        ],
      }),
    });
    expect(r.code).toBe(0);
    expect(merged(r)).toBe(true);
  });
});

describe("deterministic freshness (no model call)", () => {
  it("passes a pure rebase onto an advanced base, without needing an API key", async () => {
    const { reviewed } = seedReviewedBranch(sb);
    sb.git("checkout", "-q", "main");
    const newBase = sb.commit({ "README.md": "# app\n\nMore docs.\n" }, "docs on main");
    sb.git("push", "-q", "origin", "main");
    sb.git("checkout", "-q", "feat");
    sb.git("rebase", "-q", "main");
    const head = sb.git("rev-parse", "HEAD");
    sb.git("push", "-q", "-f", "origin", "feat");
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head, reviewed, baseOid: newBase }),
      env: { TYPESAFE_API_KEY: undefined },
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(merged(r)).toBe(true);
    expect(stub.requests).toHaveLength(0);
  });

  it("passes a merge of the base branch into the PR", async () => {
    const { reviewed } = seedReviewedBranch(sb);
    sb.git("checkout", "-q", "main");
    const newBase = sb.commit({ "docs/guide.md": "guide\n" }, "guide on main");
    sb.git("push", "-q", "origin", "main");
    sb.git("checkout", "-q", "feat");
    sb.git("merge", "-q", "--no-edit", "main");
    const head = sb.git("rev-parse", "HEAD");
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head, reviewed, baseOid: newBase }),
      env: { TYPESAFE_API_KEY: undefined },
    });
    expect(r.code).toBe(0);
    expect(merged(r)).toBe(true);
  });

  it("passes changes confined to generated/mechanical paths", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit(
      {
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "api-report/app.api.md": "## API Report\n",
        ".changeset/quiet-owls.md": "---\n'app': patch\n---\n\nGreet by name.\n",
      },
      "regenerate",
    );
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head, reviewed, baseOid: base }),
      env: { TYPESAFE_API_KEY: undefined },
    });
    expect(r.code).toBe(0);
    expect(merged(r)).toBe(true);
    expect(stub.requests).toHaveLength(0);
  });

  it("honours an explicit ignore override (which replaces the defaults)", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" }, "lock");
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head, reviewed, baseOid: base }),
      env: { TYPESAFE_API_KEY: undefined, PLEF_FRESHNESS_IGNORE: "generated/" },
    });
    // The lockfile is no longer exempt, so it needs a judgement — and there is no key.
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/TYPESAFE_API_KEY is not set/);
  });

  it("refuses a catch-all ignore override rather than exempting everything", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit({ "src/app.js": FIXED_GREET + NEW_FEATURE_FN }, "feature");
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head, reviewed, baseOid: base }),
      env: withStub({ PLEF_FRESHNESS_IGNORE: "**" }),
    });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/PLEF_FRESHNESS_IGNORE/);
    expect(merged(r)).toBe(false);
  });

  it("refuses a binary change without calling the model", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    writeFileSync(join(sb.work, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2, 0, 3]));
    sb.git("add", "logo.png");
    sb.git("commit", "-q", "-m", "logo");
    const head = sb.git("rev-parse", "HEAD");
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, { fixture: fixtureFor({ head, reviewed, baseOid: base }), env: withStub() });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/logo\.png.*binary/);
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses when the reviewed change conflicts with the new base (the resolution is unreviewed)", async () => {
    const { reviewed } = seedReviewedBranch(sb);
    sb.git("checkout", "-q", "main");
    const newBase = sb.commit({ "src/app.js": APP_V1.replace("return 'hello';", "return 'hi';") }, "hi");
    sb.git("push", "-q", "origin", "main");
    sb.git("checkout", "-q", "-b", "resolved", "main");
    const head = sb.commit(
      { "src/app.js": APP_V1.replace("return 'hello';", "return 'hi ' + nam;") },
      "reviewed change, re-applied by hand",
    );
    sb.git("push", "-q", "origin", "resolved");
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head, reviewed, baseOid: newBase }),
      env: withStub(),
    });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/src\/app\.js.*conflict/);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("model-judged freshness", () => {
  it("passes a fix that addresses a review thread, sending the hunk and the thread", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit({ "src/app.js": FIXED_GREET }, "fix typo");
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, { fixture: fixtureFor({ head, reviewed, baseOid: base }), env: withStub() });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(merged(r)).toBe(true);
    expect(stub.requests).toHaveLength(1);
    const req = stub.requests[0];
    expect(req.url).toBe("/v1/systemone");
    expect(req.auth).toBe("Bearer stub-key");
    expect(req.body.state.change.file).toBe("src/app.js");
    expect(req.body.state.change.patch).toContain("+  return 'hello ' + name;");
    expect(req.body.state.review_threads[0].comments[0].body).toBe(TYPO_THREAD.comments.nodes[0].body);
  });

  it("only offers threads started by the matching reviewer as feedback to address", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit({ "src/app.js": FIXED_GREET }, "fix typo");
    sb.git("push", "-q", "origin", "feat");
    const humanThread = {
      ...TYPO_THREAD,
      comments: { nodes: [{ author: { login: "someone" }, body: "Please also add shout()." }] },
    };
    await runGhMerge(sb, {
      fixture: fixtureFor({ head, reviewed, baseOid: base, threads: [humanThread, TYPO_THREAD] }),
      env: withStub(),
    });
    const threads = stub.requests[0].body.state.review_threads;
    expect(threads).toHaveLength(1);
    expect(threads[0].comments[0].author).toBe(COPILOT);
  });

  it("after a rebase, judges only the PR's own new edits (not the base's)", async () => {
    const { reviewed } = seedReviewedBranch(sb);
    sb.git("checkout", "-q", "main");
    const newBase = sb.commit({ "README.md": "# app\n\nMore docs.\n" }, "docs on main");
    sb.git("push", "-q", "origin", "main");
    sb.git("checkout", "-q", "feat");
    sb.git("rebase", "-q", "main");
    const head = sb.commit({ "src/app.js": FIXED_GREET }, "fix typo");
    sb.git("push", "-q", "-f", "origin", "feat");
    const r = await runGhMerge(sb, { fixture: fixtureFor({ head, reviewed, baseOid: newBase }), env: withStub() });
    expect(r.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0].body.state.change.file).toBe("src/app.js");
  });

  it("refuses a new-change hunk, listing each hunk's verdict and how to re-request", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit(
      { "src/app.js": FIXED_GREET + NEW_FEATURE_FN },
      "fix + feature",
    );
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, { fixture: fixtureFor({ head, reviewed, baseOid: base }), env: withStub() });
    expect(r.code).toBe(3);
    expect(merged(r)).toBe(false);
    expect(stub.requests).toHaveLength(2);
    // Each hunk is judged with the other hunk of the same push as context.
    for (const req of stub.requests) {
      expect(req.body.state.other_changes).toHaveLength(1);
      expect(req.body.state.other_changes[0].patch).not.toBe(req.body.state.change.patch);
    }
    expect(r.stderr).toMatch(/a fresh Copilot review is needed/);
    expect(r.stderr).toMatch(/new change/);
    expect(r.stderr).toMatch(/covered/);
    expect(r.stderr).toContain("gh pr edit 7 --add-reviewer @copilot");
  });

  it("sends only the headers of sibling hunks when their full text exceeds the context budget (bug: headers were dropped)", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const big = Array.from({ length: 200 }, (_, i) => `line ${i}: ${"x".repeat(40)}`).join("\n") + "\n";
    const head = sb.commit({ "src/app.js": FIXED_GREET, "notes/big.txt": big }, "fix + big file");
    sb.git("push", "-q", "origin", "feat");
    await runGhMerge(sb, { fixture: fixtureFor({ head, reviewed, baseOid: base }), env: withStub() });
    const forFix = stub.requests.find((q) => q.body.state.change.file === "src/app.js");
    expect(forFix).toBeDefined();
    expect(forFix.body.state.other_changes).toEqual([{ file: "notes/big.txt", patch: "@@ -0,0 +1,200 @@" }]);
  });

  it("refuses scope creep on a hunk that does map to a thread", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit(
      { "src/app.js": FIXED_GREET.replace("return 'hello ' + name;", "return 'hello ' + name; // SCOPE_CREEP") },
      "fix and more",
    );
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, { fixture: fixtureFor({ head, reviewed, baseOid: base }), env: withStub() });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/beyond/);
  });

  it("refuses a low-confidence mapping", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit(
      { "src/app.js": FIXED_GREET.replace("return 'hello ' + name;", "return 'hello ' + name; // UNSURE") },
      "fix?",
    );
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, { fixture: fixtureFor({ head, reviewed, baseOid: base }), env: withStub() });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/confidence/);
  });
});

describe("installed by symlink", () => {
  it("finds its freshness helper when invoked through a symlink on PATH", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit({ "src/app.js": FIXED_GREET }, "fix typo");
    sb.git("push", "-q", "origin", "feat");
    const bin = join(sb.root, "bin");
    mkdirSync(bin);
    symlinkSync(SCRIPT, join(bin, "gh-merge"));
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head, reviewed, baseOid: base }),
      env: withStub(),
      script: join(bin, "gh-merge"),
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
  });
});

describe("fail closed", () => {
  const seedFix = () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit({ "src/app.js": FIXED_GREET }, "fix typo");
    sb.git("push", "-q", "origin", "feat");
    return fixtureFor({ head, reviewed, baseOid: base });
  };

  it("refuses when TYPESAFE_API_KEY is not set, saying how to fix it", async () => {
    const r = await runGhMerge(sb, { fixture: seedFix(), env: withStub({ TYPESAFE_API_KEY: undefined }) });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/TYPESAFE_API_KEY is not set/);
    expect(r.stderr).toContain("gh pr edit 7 --add-reviewer @copilot");
    expect(merged(r)).toBe(false);
  });

  it("refuses on a TypeSafe server error (after retries)", async () => {
    await stub.close();
    stub = await startTypeSafeStub(() => ({ status: 500, body: "boom" }));
    const r = await runGhMerge(sb, { fixture: seedFix(), env: withStub() });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/could not verify review freshness/);
    expect(r.stderr).toMatch(/500/);
    expect(merged(r)).toBe(false);
  });

  it("refuses on a rejected key, without echoing it", async () => {
    await stub.close();
    stub = await startTypeSafeStub(() => ({ status: 401, body: "invalid key stub-key" }));
    const r = await runGhMerge(sb, { fixture: seedFix(), env: withStub() });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/401/);
    expect(r.stderr).not.toContain("stub-key");
  });

  it("refuses when the TypeSafe endpoint is unreachable", async () => {
    const r = await runGhMerge(sb, {
      fixture: seedFix(),
      env: { TYPESAFE_BASE_URL: "http://127.0.0.1:9", PLEF_TYPESAFE_MAX_RETRIES: "0" },
    });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/network/i);
  });

  it("refuses when review threads cannot be read", async () => {
    const r = await runGhMerge(sb, { fixture: { ...seedFix(), graphqlExit: 1 }, env: withStub() });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/could not verify review freshness/);
    expect(merged(r)).toBe(false);
  });

  it("refuses outside a git checkout", async () => {
    const r = await runGhMerge(sb, { fixture: seedFix(), env: withStub(), cwd: sb.root });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/clone/);
  });

  it("refuses when a commit cannot be fetched", async () => {
    const fx = seedFix();
    fx.pr.headRefOid = "0123456789abcdef0123456789abcdef01234567";
    const r = await runGhMerge(sb, { fixture: fx, env: withStub() });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/fetch/);
  });

  it("fetches reviewed and head commits it does not have locally", async () => {
    const fx = seedFix();
    sb.git("--git-dir", sb.origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    const fresh = join(sb.root, "fresh");
    sb.git("clone", "-q", "--no-checkout", "--single-branch", "--branch", "main", sb.origin, fresh);
    const r = await runGhMerge(sb, { fixture: fx, env: withStub(), cwd: fresh });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(merged(r)).toBe(true);
  });

  it("refuses an oversized diff rather than judging part of it", async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
    const base = sb.commit({ "big.txt": lines.join("\n") + "\n" }, "big");
    sb.git("push", "-q", "origin", "main");
    sb.git("checkout", "-q", "-b", "feat");
    const reviewed = sb.commit({ "big.txt": ["LINE 0", ...lines.slice(1)].join("\n") + "\n" }, "r");
    const edited = lines.map((l, i) => (i % 10 === 5 ? `${l} edited` : l));
    const head = sb.commit({ "big.txt": ["LINE 0", ...edited.slice(1)].join("\n") + "\n" }, "many hunks");
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, { fixture: fixtureFor({ head, reviewed, baseOid: base }), env: withStub() });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/too large/);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("--dry-run", () => {
  it("prints the full per-hunk verdict with probabilities and does not merge", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit({ "src/app.js": FIXED_GREET }, "fix typo");
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head, reviewed, baseOid: base }),
      args: ["7", "--dry-run"],
      env: withStub(),
    });
    expect(r.code).toBe(0);
    expect(merged(r)).toBe(false);
    expect(r.stdout).toMatch(/would merge PR #7/);
    expect(r.stdout).toMatch(/src\/app\.js @@ .* covered/);
    expect(r.stdout).toMatch(/addresses thread_1/);
    expect(r.stdout).toMatch(/confidence 0\.90/);
    expect(r.stdout).toMatch(/p\(new change\) 0\.03/);
    expect(r.stdout).toMatch(/beyond 0\.05/);
  });

  it("reports a refusal verdict with exit 3", async () => {
    const { base, reviewed } = seedReviewedBranch(sb);
    const head = sb.commit({ "src/app.js": FIXED_GREET + NEW_FEATURE_FN }, "fix + feature");
    sb.git("push", "-q", "origin", "feat");
    const r = await runGhMerge(sb, {
      fixture: fixtureFor({ head, reviewed, baseOid: base }),
      args: ["7", "--dry-run"],
      env: withStub(),
    });
    expect(r.code).toBe(3);
    expect(merged(r)).toBe(false);
    expect(r.stderr).toMatch(/NEEDS REVIEW/);
  });
});
