/**
 * Tests for the capture-core SARIF profile additions in lib/sarif.mjs
 * (emptyReviewerLog, buildFindingResult, attachFix, fingerprintText). The
 * original minimal-log helpers (buildResult, emptyLog, ...) already have
 * coverage in tests/code-review-tools.test.mjs — this file adds coverage for
 * the new profile only, plus a check that the compatibility shim re-exports
 * everything.
 *
 * @see https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as shim from "../sarif.mjs";
import {
  attachFix,
  buildFindingResult,
  emptyReviewerLog,
  fingerprintText,
  loadLog,
  SRCROOT,
  writeLog,
} from "./sarif.mjs";

const CTX = {
  reviewer: "typescript",
  worktreeRoot: "/repo",
  headSha: "a".repeat(40),
  baselineTree: "b".repeat(40),
  branch: "main",
};

const HEAD_LINES = ["function f() {", "  return 1;", "}"];

describe("compatibility shim (../sarif.mjs)", () => {
  it("re-exports the capture-core profile additions", () => {
    expect(typeof shim.buildFindingResult).toBe("function");
    expect(typeof shim.emptyReviewerLog).toBe("function");
    expect(typeof shim.attachFix).toBe("function");
    expect(typeof shim.fingerprintText).toBe("function");
  });

  it("re-exports the original minimal-log helpers unchanged", () => {
    expect(typeof shim.buildResult).toBe("function");
    expect(typeof shim.emptyLog).toBe("function");
    expect(typeof shim.normalizeLevel).toBe("function");
  });
});

describe("emptyReviewerLog", () => {
  it("builds a run with SRCROOT, baselineTree, and no versionControlProvenance when repositoryUri is absent", () => {
    const log = emptyReviewerLog(CTX);
    expect(log.version).toBe("2.1.0");
    const run = log.runs[0];
    expect(run.tool.driver.name).toBe("code-review:typescript");
    expect(run.originalUriBaseIds[SRCROOT].uri).toBe("file:///repo/");
    expect(run.properties.baselineTree).toBe(CTX.baselineTree);
    expect(run.versionControlProvenance).toBeUndefined();
    expect(run.results).toEqual([]);
  });

  it("includes versionControlProvenance when repositoryUri is given", () => {
    const log = emptyReviewerLog({ ...CTX, repositoryUri: "https://github.com/o/r", prNumber: 7, workArea: "/wa" });
    const run = log.runs[0];
    expect(run.versionControlProvenance).toEqual([
      { repositoryUri: "https://github.com/o/r", revisionId: CTX.headSha, branch: "main" },
    ]);
    expect(run.properties).toMatchObject({ workArea: "/wa", prNumber: 7, baselineTree: CTX.baselineTree });
  });

  it("rejects a missing required context field", () => {
    expect(() => emptyReviewerLog({ ...CTX, reviewer: undefined })).toThrow(/reviewer/);
    expect(() => emptyReviewerLog({ ...CTX, headSha: undefined })).toThrow(/headSha/);
  });
});

describe("fingerprintText", () => {
  it("hashes ruleId + uri + trimmed HEAD line text for scope 'line'", () => {
    const fp = fingerprintText({ ruleId: "bug", scope: "line", uri: "a.ts", headLineText: "  return 1;  " });
    const expected = createHash("sha256").update("bug\0a.ts\0return 1;", "utf8").digest("hex");
    expect(fp).toBe(expected);
  });

  it("hashes ruleId + uri + normalized message for scope 'file'", () => {
    const fp = fingerprintText({ ruleId: "bug", scope: "file", uri: "a.ts", message: "Missing   Error Handling" });
    const expected = createHash("sha256").update("bug\0a.ts\0missing error handling", "utf8").digest("hex");
    expect(fp).toBe(expected);
  });

  it("hashes with an empty uri placeholder for scope 'pr'", () => {
    const fp = fingerprintText({ ruleId: "bug", scope: "pr", message: "Something" });
    const expected = createHash("sha256").update("bug\0\0something", "utf8").digest("hex");
    expect(fp).toBe(expected);
  });

  it("is stable regardless of line-text whitespace/casing differences elsewhere (line scope only trims, doesn't lowercase)", () => {
    const a = fingerprintText({ ruleId: "x", scope: "line", uri: "a.ts", headLineText: "foo" });
    const b = fingerprintText({ ruleId: "x", scope: "line", uri: "a.ts", headLineText: "  foo  " });
    expect(a).toBe(b);
  });

  it("throws for scope 'line' without headLineText", () => {
    expect(() => fingerprintText({ ruleId: "x", scope: "line", uri: "a.ts" })).toThrow(/headLineText/);
  });
});

describe("buildFindingResult — scope 'line'", () => {
  const finding = {
    ruleId: "logic-bug",
    severity: "critical",
    confidence: "high",
    message: "off-by-one",
    file: "a.ts",
    startLine: 2,
  };

  it("builds a result with region, uriBaseId, and properties", () => {
    const r = buildFindingResult(finding, { findingId: "typescript-001", reviewer: "typescript", headLines: HEAD_LINES });
    expect(r.ruleId).toBe("logic-bug");
    expect(r.level).toBe("error");
    expect(r.message).toEqual({ text: "off-by-one" });
    expect(r.locations[0].physicalLocation).toEqual({
      artifactLocation: { uri: "a.ts", uriBaseId: SRCROOT },
      region: { startLine: 2, endLine: 2 },
    });
    expect(r.properties).toEqual({
      findingId: "typescript-001",
      severity: "critical",
      confidence: "high",
      reviewer: "typescript",
      scope: "line",
    });
    expect(r.partialFingerprints["codeReview/v1"]).toBe(
      fingerprintText({ ruleId: "logic-bug", scope: "line", uri: "a.ts", headLineText: HEAD_LINES[1] }),
    );
  });

  it("defaults endLine to startLine and defaults scope to line", () => {
    const r = buildFindingResult({ ...finding, scope: undefined }, {
      findingId: "x-001",
      reviewer: "x",
      headLines: HEAD_LINES,
    });
    expect(r.locations[0].physicalLocation.region).toEqual({ startLine: 2, endLine: 2 });
    expect(r.properties.scope).toBe("line");
  });

  it("rejects a startLine past the end of the HEAD blob", () => {
    expect(() =>
      buildFindingResult({ ...finding, startLine: 99 }, { findingId: "x-001", reviewer: "x", headLines: HEAD_LINES }),
    ).toThrow(/past end of file/);
  });

  it("rejects a missing confidence/scope/ruleId/message", () => {
    const ctx = { findingId: "x-001", reviewer: "x", headLines: HEAD_LINES };
    expect(() => buildFindingResult({ ...finding, confidence: undefined }, ctx)).toThrow(/confidence/);
    expect(() => buildFindingResult({ ...finding, confidence: "nit" }, ctx)).toThrow(/confidence/);
    expect(() => buildFindingResult({ ...finding, scope: "bogus" }, ctx)).toThrow(/scope/);
    expect(() => buildFindingResult({ ...finding, ruleId: "" }, ctx)).toThrow(/ruleId/);
    expect(() => buildFindingResult({ ...finding, message: "" }, ctx)).toThrow(/message/);
  });

  it("rejects scope 'line' without headLines or without startLine", () => {
    expect(() => buildFindingResult(finding, { findingId: "x-001", reviewer: "x" })).toThrow(/headLines/);
    expect(() =>
      buildFindingResult({ ...finding, startLine: undefined }, { findingId: "x-001", reviewer: "x", headLines: HEAD_LINES }),
    ).toThrow(/startLine/);
  });
});

describe("buildFindingResult — scope 'file'", () => {
  it("omits the region but keeps the uri", () => {
    const r = buildFindingResult(
      { ruleId: "arch", severity: "important", confidence: "medium", message: "layering violation", file: "a.ts", scope: "file" },
      { findingId: "x-001", reviewer: "x", headLines: HEAD_LINES },
    );
    expect(r.locations[0].physicalLocation).toEqual({ artifactLocation: { uri: "a.ts", uriBaseId: SRCROOT } });
    expect(r.properties.scope).toBe("file");
  });

  it("rejects startLine/endLine for scope 'file'", () => {
    expect(() =>
      buildFindingResult(
        { ruleId: "x", severity: "suggestion", confidence: "low", message: "m", file: "a.ts", scope: "file", startLine: 1 },
        { findingId: "x-001", reviewer: "x", headLines: HEAD_LINES },
      ),
    ).toThrow(/not allowed for scope "file"/);
  });
});

describe("buildFindingResult — scope 'pr'", () => {
  it("omits locations entirely and does not require headLines or file", () => {
    const r = buildFindingResult(
      { ruleId: "process", severity: "suggestion", confidence: "low", message: "consider splitting this PR", scope: "pr" },
      { findingId: "x-001", reviewer: "x" },
    );
    expect(r.locations).toBeUndefined();
    expect(r.properties.scope).toBe("pr");
  });

  it("still rejects a missing message/ruleId", () => {
    expect(() =>
      buildFindingResult(
        { ruleId: "process", severity: "suggestion", confidence: "low", message: "", scope: "pr" },
        { findingId: "x-001", reviewer: "x" },
      ),
    ).toThrow(/message/);
  });
});

describe("attachFix", () => {
  function baseResult() {
    return buildFindingResult(
      { ruleId: "x", severity: "critical", confidence: "high", message: "m", file: "a.ts", startLine: 2 },
      { findingId: "x-001", reviewer: "x", headLines: HEAD_LINES },
    );
  }

  it("attaches a single-file replacement fix", () => {
    const result = baseResult();
    attachFix(result, {
      description: "Add null check",
      changes: [{ file: "a.ts", replacements: [{ startLine: 2, endLine: 2, insertedContent: "  return 1; // fixed" }] }],
      hunkCount: 1,
    });
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0].description).toEqual({ text: "Add null check" });
    expect(result.fixes[0].artifactChanges).toEqual([
      {
        artifactLocation: { uri: "a.ts", uriBaseId: SRCROOT },
        replacements: [{ deletedRegion: { startLine: 2, endLine: 2 }, insertedContent: { text: "  return 1; // fixed" } }],
      },
    ]);
    expect(result.fixes[0].properties).toEqual({ capturedFromWorktree: true, hunks: 1 });
  });

  it("sets expandedInsertion when given", () => {
    const result = baseResult();
    attachFix(result, {
      description: "insert",
      changes: [{ file: "a.ts", replacements: [{ startLine: 1, endLine: 1, insertedContent: "x\nfunction f() {" }] }],
      hunkCount: 1,
      expandedInsertion: true,
    });
    expect(result.fixes[0].properties.expandedInsertion).toBe(true);
  });

  it("uses a kind-only artifactChange (no replacements) for add/rename/binary files", () => {
    const result = baseResult();
    attachFix(result, {
      description: "create helper",
      changes: [{ file: "b.ts", kind: "add" }],
      hunkCount: 1,
    });
    expect(result.fixes[0].artifactChanges).toEqual([
      { artifactLocation: { uri: "b.ts", uriBaseId: SRCROOT }, properties: { kind: "add" } },
    ]);
  });

  it("rejects a missing description, empty changes, or a change with neither kind nor replacements", () => {
    expect(() => attachFix(baseResult(), { changes: [{ file: "a.ts", replacements: [] }] })).toThrow(/description/);
    expect(() => attachFix(baseResult(), { description: "d", changes: [] })).toThrow(/changes/);
    expect(() => attachFix(baseResult(), { description: "d", changes: [{ file: "a.ts" }] })).toThrow(/replacements or a kind/);
  });
});

describe("writeLog atomicity (blocker #3 regression)", () => {
  // Same fix, same rationale, as writeState in lib/snapshot.mjs: writeLog
  // used a single fs.writeFileSync directly to the final path, so a
  // concurrent reader could observe a torn/partial SARIF file. Verified via
  // real filesystem behavior (see lib/snapshot.test.mjs for why fs spying
  // doesn't work for Node's ESM `fs` module) — the temp path is deterministic
  // per-process (`<final>.tmp-<pid>`), so pre-occupying it as a directory
  // forces the temp-write step itself to fail, letting the test confirm the
  // already-existing final file is left completely untouched.
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sarif-writelog-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("never touches the final file when the temp-write step fails", () => {
    const filePath = path.join(dir, "ts.sarif.json");
    const oldLog = emptyReviewerLog({ reviewer: "ts", worktreeRoot: dir, headSha: "a".repeat(40), baselineTree: "b".repeat(40) });
    writeLog(filePath, oldLog);

    const tmpPath = `${filePath}.tmp-${process.pid}`;
    fs.mkdirSync(tmpPath); // occupy the exact temp path so the write step fails (EISDIR)

    const newLog = { ...oldLog, runs: [{ ...oldLog.runs[0], results: [{ ruleId: "new" }] }] };
    expect(() => writeLog(filePath, newLog)).toThrow();
    expect(loadLog(filePath, "ts")).toEqual(oldLog); // untouched — never partially overwritten
  });

  it("leaves no stray temp file behind after a successful write (negative)", () => {
    const filePath = path.join(dir, "ts.sarif.json");
    writeLog(filePath, emptyReviewerLog({ reviewer: "ts", worktreeRoot: dir, headSha: "a".repeat(40), baselineTree: "b".repeat(40) }));
    const leftover = fs.readdirSync(dir).filter((f) => f !== "ts.sarif.json");
    expect(leftover).toEqual([]);
  });
});
