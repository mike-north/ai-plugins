#!/usr/bin/env node
// review-init — start a review session: assert the worktree is clean, capture
// the HEAD baseline, create the S0 snapshot ref, and persist state.json for
// the rest of the capture-core pipeline (record-finding, merge-findings,
// review-cleanup).
//
// Usage:
//   node review-init.mjs --work-area <dir> --worktree <dir> \
//     [--repo owner/repo --pr N --host github.com] [--head-sha SHA]
//
// stdout (on success): {"workArea":"...","headSha":"...","baselineTree":"..."}
//
// Exit codes: 0 ok, 1 unexpected, 2 usage, 3 worktree not clean.

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT, UsageError, ValidationError, parseArgs, runCli } from "./lib/cli.mjs";
import {
  createSnapshot,
  execGit,
  gitStatusPorcelain,
  revParse,
  workAreaId as computeWorkAreaId,
  writeState,
} from "./lib/snapshot.mjs";

/**
 * @returns {{ workArea: string, headSha: string, baselineTree: string }}
 */
export function reviewInit({ workArea, worktree, repo, pr, host, headSha: headShaOverride }) {
  if (!workArea) throw new UsageError("--work-area is required");
  if (!worktree) throw new UsageError("--worktree is required");
  if (pr != null && !Number.isInteger(pr)) throw new UsageError("--pr must be an integer");

  const worktreeAbs = path.resolve(worktree);
  const workAreaAbs = path.resolve(workArea);

  const status = gitStatusPorcelain(worktreeAbs);
  if (status.trim() !== "") {
    throw new ValidationError(`worktree is not clean, refusing to init:\n${status}`);
  }

  const headSha = headShaOverride ?? revParse(worktreeAbs, "HEAD");
  const baselineTree = revParse(worktreeAbs, "HEAD^{tree}");
  const branch = execGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: worktreeAbs }).trim();
  const repositoryUri = repo ? `https://${host ?? "github.com"}/${repo}` : undefined;

  fs.mkdirSync(workAreaAbs, { recursive: true });
  fs.mkdirSync(path.join(workAreaAbs, "findings"), { recursive: true });

  const id = computeWorkAreaId(workAreaAbs);
  const snap0 = createSnapshot(worktreeAbs, workAreaAbs, { workAreaId: id, seq: 0, parentSha: headSha });

  const state = {
    workAreaId: id,
    worktree: worktreeAbs,
    headSha,
    baselineTree,
    branch,
    ...(repo ? { repo } : {}),
    ...(pr != null ? { pr } : {}),
    ...(host ? { host } : {}),
    ...(repositoryUri ? { repositoryUri } : {}),
    snapshots: [snap0],
    reviewerSeq: {},
    findings: {},
  };
  writeState(workAreaAbs, state);

  return { workArea: workAreaAbs, headSha, baselineTree };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["work-area"] === true || args.worktree === true) {
    throw new UsageError("--work-area and --worktree require a value");
  }
  const pr = args.pr != null && args.pr !== true ? Number(args.pr) : undefined;
  if (args.pr != null && args.pr !== true && !Number.isInteger(pr)) {
    throw new UsageError(`--pr must be an integer (got "${args.pr}")`);
  }
  const out = reviewInit({
    workArea: args["work-area"],
    worktree: args.worktree,
    repo: typeof args.repo === "string" ? args.repo : undefined,
    pr,
    host: typeof args.host === "string" ? args.host : undefined,
    headSha: typeof args["head-sha"] === "string" ? args["head-sha"] : undefined,
  });
  process.stdout.write(JSON.stringify(out) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(main);
  process.exit(process.exitCode ?? EXIT.OK);
}
