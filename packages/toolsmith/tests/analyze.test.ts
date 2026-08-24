/**
 * `toolsmith analyze` — deterministic mining of .claude/toolsmith/history.jsonl
 * (docs/toolsmith/cli-surface.md §Verbs: the CLI emits facts; the agent adds
 * rubric judgment). History contents are sensitive: raw commands must never be
 * reproduced — only normalized, secret-redacted shapes.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTmpDirs, newHome, newProj, runCli, writeLive, writeProjectRegistry } from "./helpers.js";

afterAll(cleanupTmpDirs);

/** Deterministic history line (fixed timestamps — never Date.now()). */
function historyLine(command: string, exitCode = 0, ts = "2024-01-15T10:30:00Z"): string {
  return JSON.stringify({ ts, cwd: "/proj", command, exitCode });
}

function writeHistory(proj: string, lines: string[]): void {
  writeFileSync(join(proj, ".claude", "toolsmith", "history.jsonl"), lines.join("\n") + "\n");
}

describe("toolsmith analyze", () => {
  it("reports not-enough-signal when the log is missing", () => {
    const r = runCli(["analyze"], { proj: newProj(), home: newHome() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not enough signal");
  });

  it("reports not-enough-signal when the log is empty/unparseable", () => {
    const proj = newProj();
    writeFileSync(join(proj, ".claude", "toolsmith", "history.jsonl"), "not json\n{{{\n");
    const r = runCli(["analyze"], { proj, home: newHome() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not enough signal");
  });

  it("clusters the same broad operation with different volatile args into one row", () => {
    const proj = newProj();
    writeHistory(proj, [
      historyLine("gh api repos/o/r/pulls/101/comments"),
      historyLine("gh api repos/o/r/pulls/202/comments"),
      historyLine("gh api repos/o/r/pulls/303/comments", 1),
    ]);
    const r = runCli(["analyze"], { proj, home: newHome() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("| 3 | 1 |"); // one cluster: count 3, 1 failure
    expect(r.stdout).toContain("pulls/N/comments");
    expect(r.stdout).not.toContain("101"); // volatile args masked
  });

  it("marks watched commands and lists watched-but-uncovered candidates", () => {
    const proj = newProj();
    // `gh api` is on the shipped watchlist (watchlist-defaults.json).
    writeHistory(proj, [historyLine("gh api repos/o/r/pulls/1/comments")]);
    const r = runCli(["analyze"], { proj, home: newHome() });
    expect(r.stdout).toContain("| yes |");
    expect(r.stdout).toContain("primary candidates for forging");
  });

  it("credits an approved tool whose covers pattern matches", () => {
    const proj = newProj();
    const sha = writeLive(proj, "gh-pr-comments", "#!/bin/bash\necho c\n");
    writeProjectRegistry(proj, [
      {
        name: "gh-pr-comments",
        path: "scripts/agent-tools/gh-pr-comments",
        status: "approved",
        approvedSha256: sha,
        covers: ["gh\\s+api\\b.*comments"],
      },
    ]);
    writeHistory(proj, [historyLine("gh api repos/o/r/pulls/1/comments")]);
    const r = runCli(["analyze"], { proj, home: newHome() });
    expect(r.stdout).toContain("`gh-pr-comments`");
  });

  it("never reproduces secrets from the log (sensitive contents)", () => {
    const proj = newProj();
    const cmds = [
      'curl -H "Authorization: Bearer ghp_abcdef1234567890abcd" https://api.example.com/x',
      "deploy --token=supersecretvalue123 --env prod",
      "slack-post xoxb-12345678-abcdefghijklmnop",
    ];
    // Repeat so clusters clear the count>=3 bar even if each is its own shape.
    writeHistory(proj, [...cmds, ...cmds, ...cmds].map((c) => historyLine(c)));
    const r = runCli(["analyze"], { proj, home: newHome() });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("ghp_abcdef1234567890abcd");
    expect(r.stdout).not.toContain("supersecretvalue123");
    expect(r.stdout).not.toContain("xoxb-12345678");
  });

  it("output is deterministic across runs (byte-identical)", () => {
    const proj = newProj();
    writeHistory(proj, [
      historyLine("gh api repos/o/r/pulls/1/comments"),
      historyLine("git status --porcelain"),
      historyLine("git status --porcelain"),
      historyLine("git status --porcelain"),
    ]);
    const home = newHome();
    const a = runCli(["analyze"], { proj, home });
    const b = runCli(["analyze"], { proj, home });
    expect(a.stdout).toBe(b.stdout);
  });

  it("ends with the facts/judgment split marker for the agent's rubric layer", () => {
    const proj = newProj();
    writeHistory(proj, [historyLine("git status")]);
    const r = runCli(["analyze"], { proj, home: newHome() });
    expect(r.stdout).toContain("Rubric judgment");
    expect(r.stdout).toContain("authoring-checklist.md");
  });
});
