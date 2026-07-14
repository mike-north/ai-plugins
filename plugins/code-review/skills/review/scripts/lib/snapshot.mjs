// Git plumbing for the snapshot-subtraction fix-capture protocol: temp-index
// worktree snapshots pinned as refs, state.json persistence, and an exclusive
// lock so concurrent record-finding/merge-findings invocations serialize
// around the shared work-area state.
//
// Zero dependencies: node:fs, node:path, node:child_process, node:crypto only.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Run a git command, returning trimmed-free stdout text. Throws with stderr on failure. */
export function execGit(args, { cwd, env } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      env: env ?? process.env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const stderr = e.stderr != null ? String(e.stderr) : "";
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || e.message}`);
  }
}

/** `git status --porcelain` output (empty string means a clean worktree). */
export function gitStatusPorcelain(cwd) {
  return execGit(["status", "--porcelain"], { cwd });
}

/** `git rev-parse <ref>`, trimmed. */
export function revParse(cwd, ref) {
  return execGit(["rev-parse", ref], { cwd }).trim();
}

/** Split blob text into lines using the same trailing-newline rule everywhere in this plugin. */
function splitLines(text) {
  if (text === "") return [];
  const n = text.endsWith("\n") ? text.slice(0, -1) : text;
  return n.split("\n");
}

/**
 * Read a file's content at HEAD via `git show HEAD:<file>`.
 * Throws a descriptive error if the file does not exist in HEAD.
 *
 * @returns {{ raw: string, lines: string[] }}
 */
export function readHeadBlob(cwd, file) {
  const posixFile = toPosixPath(file);
  try {
    const raw = execGit(["show", `HEAD:${posixFile}`], { cwd });
    return { raw, lines: splitLines(raw) };
  } catch {
    throw new Error(`file does not exist in HEAD: ${posixFile}`);
  }
}

/** Convert an OS path to a POSIX (forward-slash) relative path. */
export function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

/** Deterministic short id for a work area, used to namespace its snapshot refs. */
export function workAreaId(workAreaAbsPath) {
  return createHash("sha256").update(path.resolve(workAreaAbsPath)).digest("hex").slice(0, 12);
}

function gitEnvWithIndex(indexFile) {
  return { ...process.env, GIT_INDEX_FILE: indexFile };
}

/**
 * Snapshot the current worktree content (tracked + untracked, respecting
 * .gitignore, matching `git add -A` semantics) as a tree object, without
 * touching the repository's real index.
 *
 * Implementation: point GIT_INDEX_FILE at a private temp index, seed it from
 * HEAD (`git read-tree HEAD`) so deletions are detected correctly, then
 * `git add -A` to reconcile it against the live worktree, then `write-tree`.
 *
 * @returns {string} tree oid
 */
export function snapshotWorktreeTree(worktree, indexFile) {
  // GIT_INDEX_FILE, if relative, is resolved by git relative to the child
  // process's cwd (`worktree` below) — not the caller's cwd — so a relative
  // indexFile would silently land inside the worktree instead of the work area.
  const absIndexFile = path.resolve(indexFile);
  fs.mkdirSync(path.dirname(absIndexFile), { recursive: true });
  fs.rmSync(absIndexFile, { force: true });
  const env = gitEnvWithIndex(absIndexFile);
  execGit(["read-tree", "HEAD"], { cwd: worktree, env });
  execGit(["add", "-A"], { cwd: worktree, env });
  return execGit(["write-tree"], { cwd: worktree, env }).trim();
}

const SNAPSHOT_AUTHOR = "code-review";
const SNAPSHOT_EMAIL = "noreply@localhost";
const SNAPSHOT_DATE = "1970-01-01T00:00:00Z"; // fixed — snapshot commits are plumbing, not history

/**
 * Pin a tree as a commit (parent = the review's HEAD sha) with a fixed,
 * deterministic author/committer identity and timestamp, and point
 * `refs/code-review/<workAreaId>/snap-<seq>` at it.
 */
export function pinSnapshot(worktree, { treeOid, parentSha, workAreaId: id, seq }) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: SNAPSHOT_AUTHOR,
    GIT_AUTHOR_EMAIL: SNAPSHOT_EMAIL,
    GIT_AUTHOR_DATE: SNAPSHOT_DATE,
    GIT_COMMITTER_NAME: SNAPSHOT_AUTHOR,
    GIT_COMMITTER_EMAIL: SNAPSHOT_EMAIL,
    GIT_COMMITTER_DATE: SNAPSHOT_DATE,
  };
  const args = ["commit-tree", treeOid, "-m", `code-review snapshot ${seq}`];
  if (parentSha) args.push("-p", parentSha);
  const commitOid = execGit(args, { cwd: worktree, env }).trim();
  const ref = `refs/code-review/${id}/snap-${seq}`;
  execGit(["update-ref", ref, commitOid], { cwd: worktree });
  return { commitOid, ref };
}

/**
 * Snapshot the worktree and pin it in one step.
 * @returns {{ seq: number, ref: string, commitOid: string, treeOid: string }}
 */
export function createSnapshot(worktree, workArea, { workAreaId: id, seq, parentSha }) {
  const indexFile = path.join(workArea, "tmp-index");
  const treeOid = snapshotWorktreeTree(worktree, indexFile);
  const { commitOid, ref } = pinSnapshot(worktree, { treeOid, parentSha, workAreaId: id, seq });
  return { seq, ref, commitOid, treeOid };
}

// `-c core.quotePath=false`: without it, git quotes and C-style
// octal-escapes any non-ASCII filename in "---"/"+++" lines (e.g. `"a/\303\274..."`),
// which parseUnifiedDiff has no unquoting logic for — the whole quoted,
// escaped string would otherwise leak through as the hunk's `file`.
const NO_QUOTE_PATH = ["-c", "core.quotePath=false"];

/** `git diff -U0 <a> <b>` text between two commit/tree oids. */
export function diffTrees(worktree, oidA, oidB) {
  return execGit([...NO_QUOTE_PATH, "diff", "-U0", "--no-color", oidA, oidB], { cwd: worktree });
}

/** `git diff -U0 HEAD` text against the live worktree (not a snapshot). */
export function diffWorktree(worktree) {
  return execGit([...NO_QUOTE_PATH, "diff", "-U0", "--no-color", "HEAD"], { cwd: worktree });
}

/** Delete every `refs/code-review/<workAreaId>/*` ref (best-effort per ref). */
export function deleteSnapshotRefs(worktree, id) {
  const prefix = `refs/code-review/${id}/`;
  let listing;
  try {
    listing = execGit(["for-each-ref", "--format=%(refname)", prefix], { cwd: worktree });
  } catch {
    return;
  }
  for (const ref of listing.split("\n").map((l) => l.trim()).filter(Boolean)) {
    try {
      execGit(["update-ref", "-d", ref], { cwd: worktree });
    } catch {
      // best-effort cleanup — ignore individual failures
    }
  }
}

const STATE_FILE = "state.json";

export function statePath(workArea) {
  return path.join(workArea, STATE_FILE);
}

export function readState(workArea) {
  const p = statePath(workArea);
  if (!fs.existsSync(p)) {
    throw new Error(`work area is not initialized (no state.json under ${workArea}); run review-init first`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * Write `text` to `finalPath` via a temp file + atomic rename, so a
 * concurrent reader (e.g. merge-findings.mjs, which does not hold this
 * module's lock) always sees either the fully-old or fully-new content,
 * never a torn/partial write. The temp path is per-process (not per-call) —
 * every caller of this module is expected to serialize their own writes to a
 * given file via `withLock`, so this only needs to avoid colliding with a
 * DIFFERENT process, not with itself.
 */
function writeFileAtomic(finalPath, text) {
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, text);
  fs.renameSync(tmpPath, finalPath);
}

export function writeState(workArea, state) {
  fs.mkdirSync(workArea, { recursive: true });
  writeFileAtomic(statePath(workArea), JSON.stringify(state, null, 2) + "\n");
}

const LOCK_STALE_MS = 30_000;
const LOCK_SPIN_MS = 25;
const LOCK_TIMEOUT_MS = 15_000;

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `fn` while holding an exclusive lock on `<workArea>/state.lock`,
 * acquired via mkdir-spin (mkdir is atomic even on network filesystems).
 * A lock older than `staleMs` whose owning pid is no longer alive is
 * reclaimed automatically.
 */
export function withLock(workArea, fn, { staleMs = LOCK_STALE_MS, spinMs = LOCK_SPIN_MS, timeoutMs = LOCK_TIMEOUT_MS } = {}) {
  const lockDir = path.join(workArea, "state.lock");
  fs.mkdirSync(workArea, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, "pid"), String(process.pid));
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lockDir).mtimeMs;
      } catch {
        continue; // lock vanished between our mkdir attempt and stat — retry immediately
      }
      if (age > staleMs) {
        let pid = NaN;
        try {
          pid = parseInt(fs.readFileSync(path.join(lockDir, "pid"), "utf8"), 10);
        } catch {
          // unreadable pid file — treat as stale (unowned)
        }
        if (!isPidAlive(pid)) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for lock: ${lockDir}`);
      }
      sleepSync(spinMs);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}
