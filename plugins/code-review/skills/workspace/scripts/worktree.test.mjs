/**
 * Tests for the workspace skill's worktree lifecycle script.
 *
 * `for-pr`'s GitHub resolution needs a real `gh` call and network access, so per
 * the workspace skill's own design it is only covered here for its network-free
 * parsing (`parse-pr-ref`); `create`/`list`/`remove`/`setup` are exercised
 * end-to-end against a throwaway fixture git repo (a local bare "origin" plus a
 * clone), so no network or GitHub auth is required to run this suite.
 *
 * @see https://git-scm.com/docs/git-worktree
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "worktree.sh");

/** Run worktree.sh, isolated from the machine's real global gitignore. */
function run(args, { env: extraEnv, ...opts } = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    ...opts,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...extraEnv },
  });
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** A throwaway repo with a real "origin" remote (a local bare repo) and one commit on main. */
function makeFixtureRepo() {
  // realpath: worktree.sh canonicalizes paths (via `cd && pwd`), and on macOS
  // os.tmpdir() lives under a symlink (/tmp -> /private/tmp) — resolve here so
  // path assertions compare like with like, not a symlink-vs-target mismatch.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "worktree-sh-")));
  const bare = path.join(root, "origin.git");
  execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", bare]);
  const work = path.join(root, "work");
  execFileSync("git", ["clone", "--quiet", bare, work], { stdio: ["ignore", "ignore", "ignore"] });
  fs.writeFileSync(path.join(work, "README.md"), "# fixture\n");
  git(["add", "."], work);
  git(["-c", "user.email=t@t.com", "-c", "user.name=Test", "commit", "-m", "init"], work);
  git(["push", "--quiet", "origin", "main"], work);
  return { root, bare, work };
}

let fixture;

beforeEach(() => {
  fixture = makeFixtureRepo();
});

afterEach(() => {
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

describe("usage errors (exit 2)", () => {
  it("prints usage and exits 2 with no subcommand", () => {
    const r = run([], { cwd: fixture.work });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Usage: worktree\.sh/);
  });

  it("rejects an unknown subcommand", () => {
    const r = run(["bogus"], { cwd: fixture.work });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown subcommand: bogus/);
  });

  it("rejects create with no name", () => {
    const r = run(["create"], { cwd: fixture.work });
    expect(r.status).toBe(2);
  });

  it("rejects a create name containing a slash (path traversal guard)", () => {
    const r = run(["create", "a/b"], { cwd: fixture.work });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/invalid worktree name/);
  });

  it("rejects remove with no target", () => {
    const r = run(["remove"], { cwd: fixture.work });
    expect(r.status).toBe(2);
  });

  it("rejects an unknown remove flag", () => {
    const r = run(["remove", "x", "--bogus"], { cwd: fixture.work });
    expect(r.status).toBe(2);
  });
});

describe("create", () => {
  it("creates a worktree at .claude/worktrees/<name> on a new branch from origin's default branch", () => {
    const r = run(["create", "feature-a"], { cwd: fixture.work });
    expect(r.status).toBe(0);
    const wtPath = r.stdout.trim();
    expect(wtPath).toBe(path.join(fixture.work, ".claude", "worktrees", "feature-a"));
    expect(fs.existsSync(wtPath)).toBe(true);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], wtPath).trim()).toBe("feature-a");
  });

  it("is idempotent: reuses a clean existing worktree and prints the same path", () => {
    const first = run(["create", "feature-a"], { cwd: fixture.work });
    const second = run(["create", "feature-a"], { cwd: fixture.work });
    expect(second.status).toBe(0);
    expect(second.stdout.trim()).toBe(first.stdout.trim());
  });

  it("refuses to recreate a dirty existing worktree (negative, exit 3)", () => {
    const wtPath = run(["create", "feature-a"], { cwd: fixture.work }).stdout.trim();
    fs.writeFileSync(path.join(wtPath, "dirty.txt"), "uncommitted\n");
    const r = run(["create", "feature-a"], { cwd: fixture.work });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/uncommitted changes/);
  });

  it("removes and recreates a stale/broken worktree directory (leftover, not a registered worktree)", () => {
    const wtPath = path.join(fixture.work, ".claude", "worktrees", "feature-a");
    fs.mkdirSync(wtPath, { recursive: true });
    fs.writeFileSync(path.join(wtPath, "leftover.txt"), "stale\n");
    const r = run(["create", "feature-a"], { cwd: fixture.work });
    expect(r.status).toBe(0);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], wtPath).trim()).toBe("feature-a");
    expect(fs.existsSync(path.join(wtPath, "leftover.txt"))).toBe(false);
  });

  it("creates from an explicit ref instead of the default branch", () => {
    git(["checkout", "-b", "topic"], fixture.work);
    fs.writeFileSync(path.join(fixture.work, "topic-only.txt"), "x\n");
    git(["add", "."], fixture.work);
    git(["-c", "user.email=t@t.com", "-c", "user.name=Test", "commit", "-m", "topic commit"], fixture.work);
    git(["push", "--quiet", "origin", "topic"], fixture.work);
    git(["checkout", "main"], fixture.work);

    const r = run(["create", "from-topic", "topic"], { cwd: fixture.work });
    expect(r.status).toBe(0);
    const wtPath = r.stdout.trim();
    expect(fs.existsSync(path.join(wtPath, "topic-only.txt"))).toBe(true);
  });

  it("ensures .claude/worktrees/ is gitignored via .git/info/exclude, without touching .gitignore", () => {
    run(["create", "feature-a"], { cwd: fixture.work });
    const exclude = fs.readFileSync(path.join(fixture.work, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(".claude/worktrees/");
    expect(fs.existsSync(path.join(fixture.work, ".gitignore"))).toBe(false);
  });

  it("works from inside another linked worktree (resolves the MAIN repo root, not the current one)", () => {
    const first = run(["create", "feature-a"], { cwd: fixture.work }).stdout.trim();
    const r = run(["create", "feature-b"], { cwd: first });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(path.join(fixture.work, ".claude", "worktrees", "feature-b"));
  });
});

describe("list", () => {
  it("reports no worktrees under .claude/worktrees/ when none exist", () => {
    const r = run(["list"], { cwd: fixture.work });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("lists created worktrees, filtered to .claude/worktrees/", () => {
    run(["create", "feature-a"], { cwd: fixture.work });
    const r = run(["list"], { cwd: fixture.work });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(path.join(".claude", "worktrees", "feature-a"));
    expect(r.stdout).not.toMatch(new RegExp(`^${fixture.work.replace(/[/\\]/g, "\\$&")} `, "m")); // main checkout excluded
  });
});

describe("remove", () => {
  it("removes a clean worktree and deletes its branch once merged into the default branch", () => {
    const wtPath = run(["create", "clean-topic"], { cwd: fixture.work }).stdout.trim();
    const r = run(["remove", "clean-topic"], { cwd: fixture.work });
    expect(r.status).toBe(0);
    expect(fs.existsSync(wtPath)).toBe(false);
    expect(() => git(["rev-parse", "--verify", "refs/heads/clean-topic"], fixture.work)).toThrow();
  });

  it("refuses to remove a dirty worktree without --force (negative, exit 3)", () => {
    const wtPath = run(["create", "feature-a"], { cwd: fixture.work }).stdout.trim();
    fs.writeFileSync(path.join(wtPath, "dirty.txt"), "uncommitted\n");
    const r = run(["remove", "feature-a"], { cwd: fixture.work });
    expect(r.status).toBe(3);
    expect(fs.existsSync(wtPath)).toBe(true);
  });

  it("removes a dirty worktree when --force is given", () => {
    const wtPath = run(["create", "feature-a"], { cwd: fixture.work }).stdout.trim();
    fs.writeFileSync(path.join(wtPath, "dirty.txt"), "uncommitted\n");
    const r = run(["remove", "feature-a", "--force"], { cwd: fixture.work });
    expect(r.status).toBe(0);
    expect(fs.existsSync(wtPath)).toBe(false);
  });

  it("preserves an unmerged, non-review-pr branch after removing its worktree", () => {
    run(["create", "wip"], { cwd: fixture.work });
    const wtPath = path.join(fixture.work, ".claude", "worktrees", "wip");
    fs.writeFileSync(path.join(wtPath, "unmerged.txt"), "x\n");
    git(["add", "."], wtPath);
    git(["-c", "user.email=t@t.com", "-c", "user.name=Test", "commit", "-m", "unmerged work"], wtPath);

    const r = run(["remove", "wip"], { cwd: fixture.work });
    expect(r.status).toBe(0);
    expect(git(["rev-parse", "--verify", "refs/heads/wip"], fixture.work)).toBeTruthy();
  });

  it("force-deletes a review-pr-<N> branch even when unmerged (throwaway PR-review branches)", () => {
    // Simulates the post-state of `for-pr` without a network call: a worktree
    // checked out on a review-pr-<N> branch with commits not on the default branch.
    const wtPath = path.join(fixture.work, ".claude", "worktrees", "review-pr-999");
    git(["worktree", "add", "-b", "review-pr-999", wtPath, "main"], fixture.work);
    fs.writeFileSync(path.join(wtPath, "extra.txt"), "x\n");
    git(["add", "."], wtPath);
    git(["-c", "user.email=t@t.com", "-c", "user.name=Test", "commit", "-m", "pr work"], wtPath);

    const r = run(["remove", "review-pr-999"], { cwd: fixture.work });
    expect(r.status).toBe(0);
    expect(() => git(["rev-parse", "--verify", "refs/heads/review-pr-999"], fixture.work)).toThrow();
  });

  it("rejects removing a path that is not a registered git worktree (negative)", () => {
    fs.mkdirSync(path.join(fixture.work, ".claude", "worktrees", "not-a-worktree"), { recursive: true });
    const r = run(["remove", "not-a-worktree"], { cwd: fixture.work });
    expect(r.status).toBe(1);
  });

  it("rejects removing a nonexistent worktree (negative, exit 1)", () => {
    const r = run(["remove", "does-not-exist"], { cwd: fixture.work });
    expect(r.status).toBe(1);
  });
});

describe("setup", () => {
  function fixtureDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-setup-"));
    return dir;
  }

  it("prints RUN: lines for each detected manifest, without running anything", () => {
    const dir = fixtureDir();
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
    fs.writeFileSync(path.join(dir, "Cargo.toml"), "");
    fs.writeFileSync(path.join(dir, "go.mod"), "");
    const r = run(["setup", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RUN: pnpm install --frozen-lockfile");
    expect(r.stdout).toContain("RUN: cargo check");
    expect(r.stdout).toContain("RUN: go build ./...");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("requires poetry.lock alongside pyproject.toml before suggesting poetry install (negative for the bare case)", () => {
    const dir = fixtureDir();
    fs.writeFileSync(path.join(dir, "pyproject.toml"), "");
    const bare = run(["setup", dir]);
    expect(bare.stdout.trim()).toBe("");

    fs.writeFileSync(path.join(dir, "poetry.lock"), "");
    const withLock = run(["setup", dir]);
    expect(withLock.stdout).toContain("RUN: poetry install");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("execs .claude/worktree-setup.sh instead of printing RUN: lines, when present and executable", () => {
    const dir = fixtureDir();
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), ""); // would otherwise suggest RUN: pnpm ...
    fs.mkdirSync(path.join(dir, ".claude"));
    const hook = path.join(dir, ".claude", "worktree-setup.sh");
    fs.writeFileSync(hook, "#!/usr/bin/env bash\necho HOOK_RAN\n");
    fs.chmodSync(hook, 0o755);
    const r = run(["setup", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("HOOK_RAN");
    expect(r.stdout).not.toContain("RUN:");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a nonexistent directory (negative, exit 2)", () => {
    const r = run(["setup", "/definitely/not/a/real/path"]);
    expect(r.status).toBe(2);
  });
});

describe("parse-pr-ref (network-free)", () => {
  it("parses a bare PR number", () => {
    const r = run(["parse-pr-ref", "123"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ number: "123", host: "", owner: "", repo: "", isUrl: false });
  });

  it("parses a '#123' form", () => {
    const r = run(["parse-pr-ref", "#123"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).number).toBe("123");
  });

  it("parses a github.com PR URL", () => {
    const r = run(["parse-pr-ref", "https://github.com/acme/widgets/pull/42"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      number: "42",
      host: "github.com",
      owner: "acme",
      repo: "widgets",
      isUrl: true,
    });
  });

  it("parses a GitHub Enterprise PR URL with a trailing path segment", () => {
    const r = run(["parse-pr-ref", "https://github.corp.example.com/acme/widgets/pull/42/files"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.host).toBe("github.corp.example.com");
    expect(parsed.number).toBe("42");
  });

  it("rejects a value that is neither a number nor a PR URL (negative, exit 2)", () => {
    const r = run(["parse-pr-ref", "not-a-ref"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not a PR number or PR URL/);
  });

  it("rejects a non-pull GitHub URL, e.g. an issue link (negative)", () => {
    const r = run(["parse-pr-ref", "https://github.com/acme/widgets/issues/42"]);
    expect(r.status).toBe(2);
  });
});

describe("for-pr refresh safety (finding E regression)", () => {
  // GitHub's PR refs (refs/pull/<N>/head) are ordinary git refs, so a purely
  // local bare "origin" can stand in for them here — no network or `gh` API
  // calls needed, only a stubbed `gh pr view` (worktree.sh only calls it
  // once, so a fixed-output stub is enough; no per-call sequencing required).

  function writeGhStub(dir, tsvLine) {
    const stubPath = path.join(dir, "stub-gh");
    fs.writeFileSync(stubPath, `#!/usr/bin/env bash\nprintf '%s\\n' '${tsvLine}'\n`);
    fs.chmodSync(stubPath, 0o755);
    return stubPath;
  }

  it("refuses to refresh (exit 3) when the worktree's current tip is not an ancestor of the new PR head, so a local commit would be orphaned", () => {
    const num = "42";
    const wtPath = path.join(fixture.work, ".claude", "worktrees", `review-pr-${num}`);

    // Simulate a PRIOR successful `for-pr` run: a registered worktree on
    // branch review-pr-42, at the (old) PR head.
    const oldHeadSha = git(["rev-parse", "HEAD"], fixture.work).trim();
    git(["worktree", "add", "-b", `review-pr-${num}`, wtPath, oldHeadSha], fixture.work);
    // Give the bare "origin" a refs/pull/<N>/head at the old head too, matching reality.
    git(["update-ref", `refs/pull/${num}/head`, oldHeadSha], fixture.bare);

    // A LOCAL commit on the review branch, never pushed/part of the PR.
    fs.writeFileSync(path.join(wtPath, "scratch.txt"), "local work\n");
    git(["add", "-A"], wtPath);
    git(["-c", "user.email=t@t.com", "-c", "user.name=Test", "commit", "-m", "local scratch commit"], wtPath);
    const localTip = git(["rev-parse", "HEAD"], wtPath).trim();

    // The PR head moves to a NEW commit that is a sibling of oldHeadSha, NOT a
    // descendant of localTip — so localTip is not an ancestor of the new head.
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-sh-other-"));
    git(["clone", "--quiet", fixture.bare, otherDir], undefined);
    fs.writeFileSync(path.join(otherDir, "upstream-change.txt"), "someone else's change\n");
    git(["add", "-A"], otherDir);
    git(["-c", "user.email=t@t.com", "-c", "user.name=Test", "commit", "-m", "upstream PR update"], otherDir);
    const newHeadSha = git(["rev-parse", "HEAD"], otherDir).trim();
    git(["push", "--quiet", "origin", `HEAD:refs/pull/${num}/head`], otherDir);
    fs.rmSync(otherDir, { recursive: true, force: true });

    const stubGh = writeGhStub(
      fixture.root,
      `${num}\treview-branch\t${newHeadSha}\tmain\t${oldHeadSha}\thttps://github.com/acme/widgets/pull/${num}`,
    );

    const r = run(["for-pr", num], { cwd: fixture.work, env: { GH: stubGh } });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/orphaned|ancestor|--force/i);

    // The branch was NOT force-moved — the local commit is still there.
    expect(git(["rev-parse", `review-pr-${num}`], fixture.work).trim()).toBe(localTip);
  });

  it("leaves the fresh worktree CLEAN: review-meta.json lives in the git dir, not the working tree (review-init clean-assertion regression)", () => {
    // Regression: for-pr used to write <worktree>/.claude/review-meta.json as
    // an untracked file, which failed review-init's clean-worktree assertion
    // and would have been swept into snapshot capture by `git add -A`.
    const num = "44";
    const headSha = git(["rev-parse", "HEAD"], fixture.work).trim();
    git(["update-ref", `refs/pull/${num}/head`, headSha], fixture.bare);

    const stubGh = writeGhStub(
      fixture.root,
      `${num}\treview-branch\t${headSha}\tmain\t${headSha}\thttps://github.com/acme/widgets/pull/${num}`,
    );

    const r = run(["for-pr", num], { cwd: fixture.work, env: { GH: stubGh } });
    expect(r.status).toBe(0);
    const wtPath = r.stdout.trim().split("\n").pop();

    // Working tree must be pristine — nothing untracked, nothing modified.
    expect(git(["status", "--porcelain"], wtPath)).toBe("");

    // The metadata is present in the worktree's git dir instead.
    const gitDir = git(["rev-parse", "--absolute-git-dir"], wtPath).trim();
    const meta = JSON.parse(fs.readFileSync(path.join(gitDir, "review-meta.json"), "utf8"));
    expect(meta.pr).toBe(44);
    expect(meta.headSha).toBe(headSha);
    expect(meta.host).toBe("github.com");
  });

  it("--force refreshes anyway, moving the branch to the new head", () => {
    const num = "43";
    const wtPath = path.join(fixture.work, ".claude", "worktrees", `review-pr-${num}`);

    const oldHeadSha = git(["rev-parse", "HEAD"], fixture.work).trim();
    git(["worktree", "add", "-b", `review-pr-${num}`, wtPath, oldHeadSha], fixture.work);
    git(["update-ref", `refs/pull/${num}/head`, oldHeadSha], fixture.bare);

    fs.writeFileSync(path.join(wtPath, "scratch.txt"), "local work\n");
    git(["add", "-A"], wtPath);
    git(["-c", "user.email=t@t.com", "-c", "user.name=Test", "commit", "-m", "local scratch commit"], wtPath);

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-sh-other-"));
    git(["clone", "--quiet", fixture.bare, otherDir], undefined);
    fs.writeFileSync(path.join(otherDir, "upstream-change.txt"), "someone else's change\n");
    git(["add", "-A"], otherDir);
    git(["-c", "user.email=t@t.com", "-c", "user.name=Test", "commit", "-m", "upstream PR update"], otherDir);
    const newHeadSha = git(["rev-parse", "HEAD"], otherDir).trim();
    git(["push", "--quiet", "origin", `HEAD:refs/pull/${num}/head`], otherDir);
    fs.rmSync(otherDir, { recursive: true, force: true });

    const stubGh = writeGhStub(
      fixture.root,
      `${num}\treview-branch\t${newHeadSha}\tmain\t${oldHeadSha}\thttps://github.com/acme/widgets/pull/${num}`,
    );

    const r = run(["for-pr", num, "--force"], { cwd: fixture.work, env: { GH: stubGh } });
    expect(r.status).toBe(0);
    expect(git(["rev-parse", `review-pr-${num}`], fixture.work).trim()).toBe(newHeadSha);
  });
});
