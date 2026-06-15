#!/usr/bin/env node
// @ts-check
/**
 * gh-queue.mjs — read-only work-queue engine for a GitHub-issue-driven agent fleet.
 *
 * The queue mechanics — listing ready issues, ranking them, and the "who actually has
 * what" ground-truth check — are pure git/gh reads. This is the DETECTION half of the
 * product-led-eng-fleet pattern: it never mutates anything, so it is safe to allowlist
 * and run autonomously. The RESPONSE half (claim/comment/merge/...) is the separate
 * bounded write-scripts in this directory (issue-label.sh, issue-comment.sh, ...).
 *
 * Subcommands (all read-only):
 *   list [--json]               Ranked ready queue (deadline -> priority label -> number).
 *   ground-truth <N> [--json]   Is issue N safe to claim? exit 0 = safe, 2 = blocked.
 *   status [--json]             ready / in-progress / open-PR rollup.
 *
 * Configuration (env, so the same engine works in any repo):
 *   PLEF_INPROGRESS_LABEL   label that marks a claimed issue        (default "in progress")
 *   PLEF_EXCLUDE_LABELS     comma list of labels that hide an issue (default "in progress,needs-decision,backlog")
 *   PLEF_PRIORITY_LABELS    comma list, highest-first, for ranking  (default "P0,P1,table-stakes")
 *   PLEF_STALE_HOURS        hours of silence before a claim is "stale" (default "20")
 *   GH                      override the gh binary (e.g. GH=gh_dotcom)
 *
 * Exit codes: 0 success (ground-truth: safe); 1 gh/git error; 2 ground-truth blocked / bad usage.
 */

import { spawnSync } from "node:child_process";

const ENV = process.env;
const GH = ENV.GH || "gh";
const INPROGRESS_LABEL = ENV.PLEF_INPROGRESS_LABEL || "in progress";
const EXCLUDE_LABELS = (ENV.PLEF_EXCLUDE_LABELS || "in progress,needs-decision,backlog")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PRIORITY_LABELS = (ENV.PLEF_PRIORITY_LABELS || "P0,P1,table-stakes")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const STALE_HOURS = Number(ENV.PLEF_STALE_HOURS || "20");

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  if (res.error && res.error.code === "ENOENT") {
    fail(`\`${cmd}\` is not installed or not on PATH. This needs git and the GitHub CLI (gh).`);
  }
  if (res.status !== 0) {
    fail(`\`${cmd} ${args.join(" ")}\` failed (exit ${res.status}).\n${(res.stderr || "").trim()}`);
  }
  return (res.stdout || "").trim();
}

function tryRun(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  return res.status === 0 ? (res.stdout || "").trim() : null;
}

function fail(msg) {
  process.stderr.write(`gh-queue: ${msg}\n`);
  process.exit(1);
}

function ghJson(args) {
  return JSON.parse(run(GH, args) || "null");
}

function parseDeadline(title) {
  const m = /due[:\s]\s*(\d{4}-\d{2}-\d{2})/i.exec(title);
  return m ? m[1] : null;
}

function rankKey(issue) {
  const labels = issue.labels.map((l) => l.name);
  const deadline = parseDeadline(issue.title);
  let prioIdx = PRIORITY_LABELS.findIndex((p) => labels.includes(p));
  if (prioIdx === -1) prioIdx = PRIORITY_LABELS.length;
  return {
    hasDeadline: deadline ? 0 : 1,
    deadline: deadline || "9999-99-99",
    prioIdx,
    number: issue.number,
  };
}

function compareRank(a, b) {
  const ka = rankKey(a);
  const kb = rankKey(b);
  return (
    ka.hasDeadline - kb.hasDeadline ||
    ka.deadline.localeCompare(kb.deadline) ||
    ka.prioIdx - kb.prioIdx ||
    ka.number - kb.number
  );
}

function openIssues() {
  const issues = ghJson(["issue", "list", "--state", "open", "--limit", "200", "--json", "number,title,labels,updatedAt,url"]);
  return Array.isArray(issues) ? issues : [];
}

function openPullRequests() {
  const prs = ghJson(["pr", "list", "--state", "open", "--limit", "200", "--json", "number,title,body,headRefName,isDraft,url"]);
  return Array.isArray(prs) ? prs : [];
}

function prsReferencing(n, prs) {
  const branchNeedle = new RegExp(`(^|\\D)#?${n}(\\D|$)`);
  const textNeedle = new RegExp(`#${n}(\\D|$)`);
  return prs.filter((pr) => textNeedle.test(`${pr.title}\n${pr.body || ""}`) || branchNeedle.test(pr.headRefName));
}

function hoursSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

function readyQueue() {
  return openIssues()
    .filter((i) => !i.labels.some((l) => EXCLUDE_LABELS.includes(l.name)))
    .sort(compareRank);
}

function out(s) {
  process.stdout.write(`${s}\n`);
}

function cmdList(flags) {
  const ready = readyQueue();
  if (flags.json) return out(JSON.stringify(ready, null, 2));
  if (ready.length === 0) {
    return out("Ready queue is empty. Don't manufacture work — review ready PRs or wait for the landscape to change.");
  }
  out(`Ready queue (${ready.length}) — ranked deadline → priority → number:\n`);
  for (const i of ready) {
    const deadline = parseDeadline(i.title);
    const prio = PRIORITY_LABELS.find((p) => i.labels.some((l) => l.name === p));
    const tags = [deadline && `due ${deadline}`, prio].filter(Boolean).join(", ");
    out(`  #${i.number}  ${i.title}${tags ? `  [${tags}]` : ""}`);
  }
}

function cmdGroundTruth(n, flags) {
  if (!n || !/^\d+$/.test(n)) fail("ground-truth needs a numeric issue number: gh-queue.mjs ground-truth <N>");
  tryRun("git", ["fetch", "origin", "--quiet"]);

  const issue = ghJson([
    "issue",
    "view",
    String(n),
    "--json",
    "number,title,labels,state,updatedAt,url",
  ]);
  if (!issue || issue.state !== "OPEN") {
    return verdict(flags, { issue: Number(n), safe: false, state: "CLOSED", reason: `issue #${n} is not open` });
  }
  const labels = issue.labels.map((l) => l.name);
  const prs = prsReferencing(n, openPullRequests());
  const remoteBranches = (tryRun("git", ["ls-remote", "--heads", "origin"]) || "")
    .split("\n")
    .map((line) => line.split("\t")[1])
    .filter(Boolean)
    .filter((ref) => new RegExp(`(^|/|-)#?${n}(\\D|$)`).test(ref));
  const claimed = labels.includes(INPROGRESS_LABEL);
  const idleHours = hoursSince(issue.updatedAt);

  let safe = true;
  let state = "SAFE";
  let reason = "no open PR and not claimed — safe to claim";
  if (prs.length > 0) {
    safe = false;
    state = "IN-FLIGHT";
    reason = `open PR(s) reference this issue: ${prs.map((p) => `#${p.number}${p.isDraft ? " (draft)" : ""}`).join(", ")} — do NOT duplicate`;
  } else if (claimed && idleHours <= STALE_HOURS) {
    safe = false;
    state = "TAKEN";
    reason = `labelled "${INPROGRESS_LABEL}" and active (${idleHours.toFixed(0)}h since update) — likely in flight`;
  } else if (claimed && idleHours > STALE_HOURS) {
    safe = true;
    state = "STALE-CLAIM";
    reason = `labelled "${INPROGRESS_LABEL}" but silent ${idleHours.toFixed(0)}h with no PR — stalled claim, takeable after announcing intent on the issue`;
  }

  return verdict(flags, {
    issue: Number(n),
    title: issue.title,
    safe,
    state,
    reason,
    openPrs: prs.map((p) => ({ number: p.number, isDraft: p.isDraft, url: p.url })),
    remoteBranches,
    claimed,
    idleHours: Number(idleHours.toFixed(1)),
  });
}

function verdict(flags, v) {
  if (flags.json) {
    out(JSON.stringify(v, null, 2));
  } else {
    out(`#${v.issue} ${v.title ? `— ${v.title}\n` : ""}${v.state}: ${v.reason}`);
    if (v.openPrs && v.openPrs.length) out(`  open PRs: ${v.openPrs.map((p) => `#${p.number}`).join(", ")}`);
    if (v.remoteBranches && v.remoteBranches.length) out(`  remote branches: ${v.remoteBranches.join(", ")}`);
  }
  process.exit(v.safe ? 0 : 2);
}

function cmdStatus(flags) {
  const issues = openIssues();
  const prs = openPullRequests();
  const rollup = {
    ready: issues.filter((i) => !i.labels.some((l) => EXCLUDE_LABELS.includes(l.name))).length,
    inProgress: issues.filter((i) => i.labels.some((l) => l.name === INPROGRESS_LABEL)).length,
    openPrs: prs.length,
    draftPrs: prs.filter((p) => p.isDraft).length,
  };
  if (flags.json) return out(JSON.stringify(rollup, null, 2));
  out(`queue: ${rollup.ready} ready · ${rollup.inProgress} in progress · ${rollup.openPrs} open PRs (${rollup.draftPrs} draft)`);
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    if (a === "--json") flags.json = true;
    else positional.push(a);
  }
  return { flags, positional };
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);
  switch (sub) {
    case "list":
      return cmdList(flags);
    case "ground-truth":
      return cmdGroundTruth(positional[0], flags);
    case "status":
      return cmdStatus(flags);
    default:
      out(
        [
          "Usage: gh-queue.mjs <list|ground-truth|status> [args]   (read-only)",
          "",
          "  list [--json]               Ranked ready queue.",
          "  ground-truth <N> [--json]   Is #N safe to claim? exit 0 = safe, 2 = blocked.",
          "  status [--json]             ready / in-progress / open-PR rollup.",
          "",
          "Writes (claim, comment, merge, ...) are the bounded *.sh scripts in this directory.",
        ].join("\n"),
      );
      process.exit(sub ? 2 : 0);
  }
}

main();
