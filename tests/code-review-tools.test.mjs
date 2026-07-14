/**
 * Tests for the code-review plugin's deterministic finding tools.
 *
 * These guard the boundary the plugin relies on: agents supply structured
 * findings; this code validates line numbers against real files, maps severity
 * to SARIF level, encodes fixes, and emits valid minimal SARIF 2.1.0.
 *
 * @see https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildResult,
  normalizeLevel,
  emptyLog,
} from "../plugins/code-review/skills/review/scripts/sarif.mjs";
import { recordFinding } from "../plugins/code-review/skills/review/scripts/record-finding.mjs";
import { reviewInit } from "../plugins/code-review/skills/review/scripts/review-init.mjs";
import { makeFixtureRepo, removeDir } from "../plugins/code-review/skills/review/scripts/test-support/git-fixture.mjs";
import {
  renderFindings,
  loadWorkAreaLogs,
} from "../plugins/code-review/skills/review/scripts/render-findings.mjs";

let root; // temp "repo" root holding a sample source file
let workArea;
const SAMPLE = "src/sample.ts";
const SAMPLE_LINES = 10;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-root-"));
  workArea = fs.mkdtempSync(path.join(os.tmpdir(), "cr-wa-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  // 10 lines, no trailing-newline ambiguity (countLines must report 10).
  const body = Array.from({ length: SAMPLE_LINES }, (_, i) => `line ${i + 1}`).join("\n");
  fs.writeFileSync(path.join(root, SAMPLE), body + "\n");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(workArea, { recursive: true, force: true });
});

describe("normalizeLevel", () => {
  it("maps the human severity vocabulary to SARIF levels", () => {
    expect(normalizeLevel({ severity: "critical" })).toBe("error"); // spec: critical → error
    expect(normalizeLevel({ severity: "important" })).toBe("warning"); // spec: important → warning
    expect(normalizeLevel({ severity: "suggestion" })).toBe("note"); // spec: suggestion → note
  });

  it("passes through valid SARIF levels", () => {
    expect(normalizeLevel({ level: "error" })).toBe("error");
    expect(normalizeLevel({ level: "WARNING" })).toBe("warning"); // case-insensitive
  });

  it("rejects invalid level/severity and missing input", () => {
    expect(() => normalizeLevel({ level: "fatal" })).toThrow();
    expect(() => normalizeLevel({ severity: "nit" })).toThrow();
    expect(() => normalizeLevel({})).toThrow();
  });
});

describe("buildResult — valid findings", () => {
  it("builds a line-level result with a region", () => {
    const r = buildResult(
      { ruleId: "logic-bug", severity: "critical", message: "off-by-one", file: SAMPLE, startLine: 3, endLine: 5 },
      root,
    );
    expect(r.ruleId).toBe("logic-bug");
    expect(r.level).toBe("error");
    expect(r.message).toEqual({ text: "off-by-one" });
    const loc = r.locations[0].physicalLocation;
    expect(loc.artifactLocation.uri).toBe(SAMPLE);
    expect(loc.region).toEqual({ startLine: 3, endLine: 5 });
  });

  it("defaults endLine to startLine", () => {
    const r = buildResult(
      { ruleId: "x", level: "note", message: "m", file: SAMPLE, startLine: 7 },
      root,
    );
    expect(r.locations[0].physicalLocation.region).toEqual({ startLine: 7, endLine: 7 });
  });

  it("allows a general (no-location) finding", () => {
    const r = buildResult({ ruleId: "arch", severity: "important", message: "cross-cutting" }, root);
    expect(r.locations).toBeUndefined();
    expect(r.level).toBe("warning");
  });

  it("allows a file-level finding (file, no startLine)", () => {
    const r = buildResult({ ruleId: "x", level: "note", message: "m", file: SAMPLE }, root);
    const loc = r.locations[0].physicalLocation;
    expect(loc.artifactLocation.uri).toBe(SAMPLE);
    expect(loc.region).toBeUndefined();
  });

  it("encodes a suggested fix as a SARIF replacement", () => {
    const r = buildResult(
      {
        ruleId: "x",
        severity: "suggestion",
        message: "rename",
        file: SAMPLE,
        startLine: 2,
        endLine: 2,
        fix: { replacement: "line 2 renamed" },
      },
      root,
    );
    const repl = r.fixes[0].artifactChanges[0].replacements[0];
    expect(r.fixes[0].artifactChanges[0].artifactLocation.uri).toBe(SAMPLE);
    expect(repl.deletedRegion).toEqual({ startLine: 2, endLine: 2 });
    expect(repl.insertedContent).toEqual({ text: "line 2 renamed" });
  });
});

describe("buildResult — rejected findings", () => {
  const base = { ruleId: "x", severity: "critical", message: "m", file: SAMPLE };

  it("rejects missing ruleId and message", () => {
    expect(() => buildResult({ severity: "critical", message: "m" }, root)).toThrow(/ruleId/);
    expect(() => buildResult({ ruleId: "x", severity: "critical" }, root)).toThrow(/message/);
  });

  it("rejects a startLine past end of file", () => {
    expect(() => buildResult({ ...base, startLine: SAMPLE_LINES + 1 }, root)).toThrow(/past end of file/);
  });

  it("rejects startLine < 1", () => {
    expect(() => buildResult({ ...base, startLine: 0 }, root)).toThrow(/>= 1/);
  });

  it("rejects an inverted range (endLine < startLine)", () => {
    expect(() => buildResult({ ...base, startLine: 5, endLine: 3 }, root)).toThrow(/< startLine/);
  });

  it("rejects an endLine past end of file", () => {
    expect(() => buildResult({ ...base, startLine: 5, endLine: SAMPLE_LINES + 2 }, root)).toThrow(
      /past end of file/,
    );
  });

  it("rejects a nonexistent file", () => {
    expect(() => buildResult({ ...base, file: "src/nope.ts", startLine: 1 }, root)).toThrow(
      /does not exist/,
    );
  });

  it("rejects startLine without a file", () => {
    expect(() => buildResult({ ruleId: "x", severity: "critical", message: "m", startLine: 1 }, root)).toThrow(
      /without finding.file/,
    );
  });

  it("rejects a fix without a file and a non-string replacement", () => {
    expect(() =>
      buildResult({ ruleId: "x", severity: "critical", message: "m", fix: { replacement: "y" } }, root),
    ).toThrow(/fix requires/);
    expect(() =>
      buildResult({ ...base, startLine: 1, fix: { replacement: 42 } }, root),
    ).toThrow(/replacement must be a string/);
  });
});

// recordFinding now records against a review *session* (state.json created by
// review-init, keyed by --reviewer, region validated against the HEAD blob)
// rather than an arbitrary `lens`/`root` pair — see
// plugins/code-review/skills/review/scripts/record-finding.test.mjs for full
// coverage of that contract. This block only checks the SARIF file it
// produces is still what renderFindings/loadWorkAreaLogs expect.
describe("recordFinding", () => {
  it("writes valid minimal SARIF and appends across calls", () => {
    const reviewer = "code-quality";
    const repo = makeFixtureRepo({ [SAMPLE]: Array.from({ length: SAMPLE_LINES }, (_, i) => `line ${i + 1}`).join("\n") + "\n" });
    const sessionWorkArea = fs.mkdtempSync(path.join(os.tmpdir(), "cr-wa-session-"));
    try {
      reviewInit({ workArea: sessionWorkArea, worktree: repo });
      recordFinding({ workArea: sessionWorkArea, reviewer, finding: { ruleId: "a", severity: "critical", confidence: "high", message: "first", file: SAMPLE, startLine: 1 } });
      recordFinding({ workArea: sessionWorkArea, reviewer, finding: { ruleId: "b", severity: "suggestion", confidence: "low", message: "second", scope: "pr" } });

      const file = path.join(sessionWorkArea, "findings", `${reviewer}.sarif.json`);
      const log = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(log.version).toBe("2.1.0"); // SARIF spec version
      expect(log.runs[0].tool.driver.name).toBe("code-review:code-quality");
      expect(log.runs[0].results).toHaveLength(2);
      expect(log.runs[0].results[0].ruleId).toBe("a");
      expect(log.runs[0].results[1].ruleId).toBe("b");
    } finally {
      removeDir(repo);
      removeDir(sessionWorkArea);
    }
  });
});

describe("renderFindings", () => {
  it("reports no findings for an empty log set", () => {
    const out = renderFindings([emptyLog("tests")]);
    expect(out).toContain("No findings.");
  });

  it("groups by level with correct counts, labels, and locations", () => {
    const log = emptyLog("code-quality");
    log.runs[0].results.push(
      buildResult({ ruleId: "bug", severity: "critical", message: "boom", file: SAMPLE, startLine: 4 }, root),
      buildResult({ ruleId: "nit", severity: "suggestion", message: "tidy", file: SAMPLE, startLine: 6, fix: { replacement: "x" } }, root),
    );
    const out = renderFindings([log]);
    expect(out).toContain("1 critical, 0 important, 1 suggestion");
    expect(out).toContain("## CRITICAL (1)");
    expect(out).toContain("## SUGGESTION (1)");
    expect(out).toContain(`${SAMPLE}:4`);
    expect(out).toContain("_(code-quality/bug)_");
    expect(out).toContain("[suggested fix]"); // only the suggestion carried a fix
  });

  it("loads logs from a work area directory", () => {
    // Seed the directory directly (independent of the recordFinding block above).
    const lens = "loaded-from-disk";
    const log = emptyLog(lens);
    log.runs[0].results.push(buildResult({ ruleId: "x", severity: "important", message: "m" }, root));
    fs.mkdirSync(path.join(workArea, "findings"), { recursive: true });
    fs.writeFileSync(path.join(workArea, "findings", `${lens}.sarif.json`), JSON.stringify(log, null, 2) + "\n");

    const logs = loadWorkAreaLogs(workArea);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const out = renderFindings(logs);
    expect(out).toContain("# Code Review — Findings");
  });
});
