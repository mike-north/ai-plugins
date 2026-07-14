/**
 * Tests for render-review.mjs: rendering a MERGED SARIF log (the shape
 * merge-findings.mjs produces — see lib/sarif.mjs's buildFindingResult /
 * attachFix and merge-findings.mjs's run.properties) into a report.
 *
 * Fixture SARIF logs below are hand-built from the documented merged-SARIF
 * profile, not captured from running the implementation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureRepo, removeDir } from "./test-support/git-fixture.mjs";
import {
  computeCounts,
  deriveVerdict,
  formatAttribution,
  formatLocation,
  parseRepositoryUri,
  reconstructDiffBlock,
  renderGithubBody,
  renderReview,
  VALID_FORMATS,
} from "./render-review.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "render-review.mjs");

function lineResult({ ruleId, level, message, file, startLine, endLine, confidence = "high", scope = "line", extraProps = {}, fixes }) {
  return {
    ruleId,
    level,
    message: { text: message },
    properties: { findingId: `${ruleId}-1`, confidence, reviewer: "typescript", scope, ...extraProps },
    ...(scope === "pr"
      ? {}
      : { locations: [{ physicalLocation: { artifactLocation: { uri: file }, ...(startLine != null ? { region: { startLine, endLine: endLine ?? startLine } } : {}) } }] }),
    ...(fixes ? { fixes } : {}),
  };
}

function mergedLog(results, { reviewers = ["typescript"], prNumber = 42, revisionId = "abcdef1234567890", repositoryUri = "https://github.com/acme/widgets" } = {}) {
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "code-review", rules: [] } },
        properties: { reviewers, prNumber, baselineTree: "tree-oid" },
        versionControlProvenance: [{ repositoryUri, revisionId, branch: "feature-x" }],
        results,
      },
    ],
  };
}

describe("parseRepositoryUri", () => {
  it("parses a github.com repository URI", () => {
    expect(parseRepositoryUri("https://github.com/acme/widgets")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("returns null for a malformed or missing URI (negative)", () => {
    expect(parseRepositoryUri("not-a-uri")).toBeNull();
    expect(parseRepositoryUri(undefined)).toBeNull();
  });
});

describe("deriveVerdict", () => {
  it("returns Request changes when any result is error-level", () => {
    expect(deriveVerdict([{ level: "warning" }, { level: "error" }])).toBe("Request changes");
  });
  it("returns Comment only when the worst level is warning", () => {
    expect(deriveVerdict([{ level: "note" }, { level: "warning" }])).toBe("Comment only");
  });
  it("returns Looks good when there are only notes or nothing at all (negative)", () => {
    expect(deriveVerdict([{ level: "note" }])).toBe("Looks good");
    expect(deriveVerdict([])).toBe("Looks good");
  });
});

describe("computeCounts", () => {
  it("buckets by level for scope:line and separately counts design-level (scope file|pr)", () => {
    const results = [
      lineResult({ ruleId: "a", level: "error", message: "m", file: "x.ts", startLine: 1 }),
      lineResult({ ruleId: "b", level: "warning", message: "m", file: "x.ts", startLine: 2 }),
      lineResult({ ruleId: "c", level: "note", message: "m", file: "x.ts", startLine: 3 }),
      lineResult({ ruleId: "d", level: "warning", message: "m", file: "x.ts", scope: "file" }),
      lineResult({ ruleId: "e", level: "error", message: "m", scope: "pr" }),
    ];
    expect(computeCounts(results)).toEqual({ critical: 1, important: 1, suggestions: 1, designLevel: 2 });
  });

  it("returns all zeros for an empty result set (negative/edge)", () => {
    expect(computeCounts([])).toEqual({ critical: 0, important: 0, suggestions: 0, designLevel: 0 });
  });
});

describe("formatLocation", () => {
  it("formats a single line as path:line", () => {
    expect(formatLocation(lineResult({ ruleId: "a", level: "error", message: "m", file: "x.ts", startLine: 5 }))).toBe(
      "x.ts:5",
    );
  });
  it("formats a range as path:start-end", () => {
    expect(
      formatLocation(lineResult({ ruleId: "a", level: "error", message: "m", file: "x.ts", startLine: 5, endLine: 8 })),
    ).toBe("x.ts:5-8");
  });
  it("formats scope:file as a bare path", () => {
    expect(formatLocation(lineResult({ ruleId: "a", level: "warning", message: "m", file: "x.ts", scope: "file" }))).toBe(
      "x.ts",
    );
  });
  it("formats scope:pr as (pr-wide) (negative: no location at all)", () => {
    expect(formatLocation(lineResult({ ruleId: "a", level: "error", message: "m", scope: "pr" }))).toBe("(pr-wide)");
  });
});

describe("formatAttribution", () => {
  it("renders ruleId and confidence", () => {
    expect(
      formatAttribution(lineResult({ ruleId: "logic-bug", level: "error", message: "m", file: "x.ts", startLine: 1, confidence: "high" })),
    ).toBe("_(logic-bug, high)_");
  });
  it("appends corroborating reviewers when present", () => {
    const r = lineResult({
      ruleId: "logic-bug",
      level: "error",
      message: "m",
      file: "x.ts",
      startLine: 1,
      extraProps: { corroboratedBy: ["rust", "generalist"] },
    });
    expect(formatAttribution(r)).toBe("_(logic-bug, high, corroborated by rust, generalist)_");
  });
});

describe("reconstructDiffBlock", () => {
  const getHeadLines = (file) => ({ "x.ts": ["line1", "line2", "line3"] })[file];

  it("renders deletions then insertions for a single replacement", () => {
    const fix = {
      artifactChanges: [
        { artifactLocation: { uri: "x.ts" }, replacements: [{ deletedRegion: { startLine: 2, endLine: 2 }, insertedContent: { text: "line2 fixed" } }] },
      ],
    };
    expect(reconstructDiffBlock(fix, getHeadLines)).toBe("```diff\n-line2\n+line2 fixed\n```");
  });

  it("renders a pure deletion (empty insertedContent) with no + lines", () => {
    const fix = {
      artifactChanges: [
        { artifactLocation: { uri: "x.ts" }, replacements: [{ deletedRegion: { startLine: 2, endLine: 3 }, insertedContent: { text: "" } }] },
      ],
    };
    expect(reconstructDiffBlock(fix, getHeadLines)).toBe("```diff\n-line2\n-line3\n```");
  });

  it("renders multiple replacements across files in artifactChanges order", () => {
    const multiFile = (file) => ({ "a.ts": ["a1"], "b.ts": ["b1"] })[file];
    const fix = {
      artifactChanges: [
        { artifactLocation: { uri: "a.ts" }, replacements: [{ deletedRegion: { startLine: 1, endLine: 1 }, insertedContent: { text: "a1 fixed" } }] },
        { artifactLocation: { uri: "b.ts" }, replacements: [{ deletedRegion: { startLine: 1, endLine: 1 }, insertedContent: { text: "b1 fixed" } }] },
      ],
    };
    expect(reconstructDiffBlock(fix, multiFile)).toBe("```diff\n-a1\n+a1 fixed\n-b1\n+b1 fixed\n```");
  });

  it("renders a whole-file (add/rename/binary) artifactChange as a marker line, not a diff body (negative: no replacements)", () => {
    const fix = { artifactChanges: [{ artifactLocation: { uri: "new.ts" }, properties: { kind: "add" } }] };
    expect(reconstructDiffBlock(fix, getHeadLines)).toBe("```diff\n# new.ts: whole-file add, not shown\n```");
  });

  it("widens the fence beyond the longest backtick run in the reconstructed content, so it cannot break out of the code block (finding D regression)", () => {
    // A markdown file with a fenced code example inside it is exactly the
    // real-world case: the file's own content contains a ``` (or longer) run,
    // which a fixed ` ```diff ` fence cannot safely contain.
    const getHeadLinesWithBackticks = (file) => ({ "docs.md": ["before", "```js\ncode();\n```", "after"] })[file];
    const fix = {
      artifactChanges: [
        {
          artifactLocation: { uri: "docs.md" },
          replacements: [{ deletedRegion: { startLine: 2, endLine: 2 }, insertedContent: { text: "````\nother fence\n````" } }],
        },
      ],
    };
    const block = reconstructDiffBlock(fix, getHeadLinesWithBackticks);
    // Opening/closing fence must be longer than any backtick run appearing inside.
    const fenceMatch = /^(`{3,})diff\n/.exec(block);
    expect(fenceMatch).not.toBeNull();
    const fence = fenceMatch[1];
    const body = block.slice(fenceMatch[0].length, block.length - fence.length - 1); // strip opening fence line + trailing closing fence
    const longestRunInBody = (body.match(/`+/g) ?? []).reduce((max, m) => Math.max(max, m.length), 0);
    expect(fence.length).toBeGreaterThan(longestRunInBody);
    expect(block.endsWith(`\n${fence}`)).toBe(true);
  });
});

describe("renderReview (end-to-end)", () => {
  it("rejects an invalid format (negative)", () => {
    expect(() => renderReview(mergedLog([]), { format: "xml" })).toThrow(/format must be one of/);
    expect(VALID_FORMATS.has("xml")).toBe(false);
  });

  it("reports 'No findings.' and a Looks good verdict for an empty result set (negative/edge)", () => {
    const out = renderReview(mergedLog([], { reviewers: ["typescript", "tests"] }));
    expect(out).toContain("## Review: acme/widgets#42 @ abcdef1 — Looks good");
    expect(out).toContain("0 finding(s) from 2 reviewer(s): 0 critical, 0 important, 0 suggestion(s), 0 design-level");
    expect(out).toContain("No findings.");
  });

  it("renders Critical/Important/Suggestions sections in level order with location, message, and attribution", () => {
    const results = [
      lineResult({ ruleId: "logic-bug", level: "error", message: "off-by-one", file: "src/a.ts", startLine: 10 }),
      lineResult({ ruleId: "nit", level: "note", message: "rename this", file: "src/b.ts", startLine: 3, endLine: 4 }),
      lineResult({ ruleId: "unused-import", level: "warning", message: "dead import", file: "src/c.ts", startLine: 1 }),
    ];
    const out = renderReview(mergedLog(results));
    expect(out).toContain("## Review: acme/widgets#42 @ abcdef1 — Request changes");
    expect(out).toContain("1 critical, 1 important, 1 suggestion(s), 0 design-level");
    const criticalIdx = out.indexOf("### Critical (1)");
    const importantIdx = out.indexOf("### Important (1)");
    const suggestionsIdx = out.indexOf("### Suggestions (1)");
    expect(criticalIdx).toBeGreaterThan(-1);
    expect(criticalIdx).toBeLessThan(importantIdx);
    expect(importantIdx).toBeLessThan(suggestionsIdx);
    expect(out).toContain("- **`src/a.ts:10`** — off-by-one _(logic-bug, high)_");
    expect(out).toContain("- **`src/b.ts:3-4`** — rename this _(nit, high)_");
  });

  it("renders a Design-level section for scope file|pr findings, with a level label", () => {
    const results = [
      lineResult({ ruleId: "arch", level: "warning", message: "layering violation", file: "src/a.ts", scope: "file" }),
      lineResult({ ruleId: "scope-creep", level: "error", message: "unrelated refactor", scope: "pr" }),
    ];
    const out = renderReview(mergedLog(results));
    expect(out).toContain("### Design-level (2)");
    expect(out).toContain("- **`src/a.ts`** — layering violation _(IMPORTANT)_ _(arch, high)_");
    expect(out).toContain("- **`(pr-wide)`** — unrelated refactor _(CRITICAL)_ _(scope-creep, high)_");
  });

  it("renders a 'Not posted inline' demotion appendix with the reason, for any properties.demoted result", () => {
    const results = [
      lineResult({
        ruleId: "overflow-1",
        level: "note",
        message: "too many findings",
        file: "src/a.ts",
        startLine: 1,
        extraProps: { demoted: "overflow" },
      }),
    ];
    const out = renderReview(mergedLog(results));
    expect(out).toContain("### Not posted inline (1)");
    expect(out).toContain("- **`src/a.ts:1`** — too many findings (reason: overflow)");
    expect(out).not.toContain("### Suggestions"); // demoted findings are excluded from their level section
  });

  it("includes a fix's reconstructed diff block inline when a worktree is given", () => {
    const repo = makeFixtureRepo({ "src/a.ts": "one\ntwo\nthree\n" });
    try {
      const results = [
        lineResult({
          ruleId: "logic-bug",
          level: "error",
          message: "off-by-one",
          file: "src/a.ts",
          startLine: 2,
          fixes: [
            {
              description: { text: "fix it" },
              artifactChanges: [
                { artifactLocation: { uri: "src/a.ts" }, replacements: [{ deletedRegion: { startLine: 2, endLine: 2 }, insertedContent: { text: "two fixed" } }] },
              ],
            },
          ],
        }),
      ];
      const out = renderReview(mergedLog(results), { worktree: repo });
      expect(out).toContain("```diff\n-two\n+two fixed\n```");
    } finally {
      removeDir(repo);
    }
  });

  it("omits the diff block (but still renders the finding) when no worktree is given (negative)", () => {
    const results = [
      lineResult({
        ruleId: "logic-bug",
        level: "error",
        message: "off-by-one",
        file: "src/a.ts",
        startLine: 2,
        fixes: [
          {
            description: { text: "fix it" },
            artifactChanges: [
              { artifactLocation: { uri: "src/a.ts" }, replacements: [{ deletedRegion: { startLine: 2, endLine: 2 }, insertedContent: { text: "two fixed" } }] },
            ],
          },
        ],
      }),
    ];
    const out = renderReview(mergedLog(results));
    expect(out).toContain("off-by-one");
    expect(out).not.toContain("```diff");
  });

  it("prefixes a top-level '# Code Review' heading only for the terminal format", () => {
    const log = mergedLog([]);
    expect(renderReview(log, { format: "terminal" }).startsWith("# Code Review\n\n## Review:")).toBe(true);
    expect(renderReview(log, { format: "markdown" }).startsWith("## Review:")).toBe(true);
    expect(renderReview(log, { format: "github-body" }).startsWith("## Review:")).toBe(true);
  });

  it("renderGithubBody is exactly renderReview with format github-body", () => {
    const log = mergedLog([lineResult({ ruleId: "a", level: "note", message: "m", file: "x.ts", startLine: 1 })]);
    expect(renderGithubBody(log)).toBe(renderReview(log, { format: "github-body" }));
  });
});

describe("CLI", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "render-review-cli-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function run(args) {
    return spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });
  }

  it("rejects a missing --sarif (negative, exit 2)", () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--sarif/);
  });

  it("rejects an invalid --format (negative, exit 2)", () => {
    const sarifPath = path.join(dir, "merged.sarif.json");
    fs.writeFileSync(sarifPath, JSON.stringify(mergedLog([])));
    const r = run(["--sarif", sarifPath, "--format", "xml"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--format must be one of/);
  });

  it("renders a report to stdout for a valid --sarif file", () => {
    const sarifPath = path.join(dir, "merged.sarif.json");
    fs.writeFileSync(sarifPath, JSON.stringify(mergedLog([])));
    const r = run(["--sarif", sarifPath]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("## Review: acme/widgets#42");
  });

  it("reads run.properties.worktree directly (item 7 follow-up), reconstructing a fix's diff block without needing --work-area", () => {
    const repo = makeFixtureRepo({ "a.ts": "one\ntwo\nthree\n" });
    try {
      const log = mergedLog([
        lineResult({
          ruleId: "logic-bug",
          level: "error",
          message: "off-by-one",
          file: "a.ts",
          startLine: 2,
          fixes: [
            {
              description: { text: "fix it" },
              artifactChanges: [
                { artifactLocation: { uri: "a.ts" }, replacements: [{ deletedRegion: { startLine: 2, endLine: 2 }, insertedContent: { text: "two fixed" } }] },
              ],
            },
          ],
        }),
      ]);
      log.runs[0].properties.worktree = repo; // set directly, no --work-area / state.json involved
      const sarifPath = path.join(dir, "merged.sarif.json");
      fs.writeFileSync(sarifPath, JSON.stringify(log));
      const r = run(["--sarif", sarifPath]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("```diff\n-two\n+two fixed\n```");
    } finally {
      removeDir(repo);
    }
  });
});
