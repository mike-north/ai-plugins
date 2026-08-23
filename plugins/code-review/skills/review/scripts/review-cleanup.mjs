#!/usr/bin/env node
// review-cleanup — delete a review session's snapshot refs, temp index, and
// lock directory. Does NOT remove the work-area directory itself (state.json
// and findings/*.sarif.json are left for inspection/archival) and does NOT
// remove the git worktree — that is the caller's responsibility.
//
// Usage:
//   node review-cleanup.mjs --work-area <dir>
//
// Exit codes: 0 ok, 1 unexpected, 2 usage.

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT, UsageError, parseArgs, runCli, isMainModule } from "./lib/cli.mjs";
import { deleteSnapshotRefs, readState } from "./lib/snapshot.mjs";

/** @returns {{ workArea: string, refsDeleted: string }} */
export function reviewCleanup({ workArea }) {
  if (!workArea) throw new UsageError("--work-area is required");
  const workAreaAbs = path.resolve(workArea); // see record-finding.mjs for why this must be absolute
  const state = readState(workAreaAbs);

  deleteSnapshotRefs(state.worktree, state.workAreaId);
  fs.rmSync(path.join(workAreaAbs, "tmp-index"), { force: true });
  fs.rmSync(path.join(workAreaAbs, "state.lock"), { recursive: true, force: true });

  return { workArea: workAreaAbs, refsDeleted: `refs/code-review/${state.workAreaId}/*` };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workArea = args["work-area"];
  if (!workArea || workArea === true) throw new UsageError("--work-area <dir> is required");
  const out = reviewCleanup({ workArea });
  process.stdout.write(JSON.stringify(out) + "\n");
}

if (isMainModule(import.meta.url)) {
  runCli(main);
  process.exit(process.exitCode ?? EXIT.OK);
}
