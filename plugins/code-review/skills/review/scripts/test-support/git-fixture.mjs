// Test-only helper: build throwaway git repositories for exercising the
// capture-core scripts against *real* git output rather than hand-crafted
// diff text. Dates are fixed (never `new Date()`/`Date.now()`) so fixtures
// are fully deterministic.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const FIXED_DATE = "2024-01-15T10:00:00Z";

export function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_AUTHOR_DATE: FIXED_DATE,
    GIT_COMMITTER_DATE: FIXED_DATE,
  };
}

export function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv() });
}

/**
 * Create a temp git repo on branch "main" with one initial commit.
 * @param {Record<string,string>} files  relative path → file content
 * @returns {string} absolute repo path
 */
export function makeFixtureRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-fixture-"));
  git(["init", "-q", "-b", "main"], dir);
  writeFiles(dir, files);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "initial"], dir);
  return dir;
}

export function writeFiles(repo, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
