/**
 * Tests for lib/cli.mjs — the shared argv parser and exit-code contract.
 */
import { describe, expect, it } from "vitest";
import { EXIT, parseArgs } from "./cli.mjs";

describe("parseArgs", () => {
  it("parses --flag value and --flag booleans", () => {
    expect(parseArgs(["--work-area", "/tmp/wa", "--dry-run"])).toEqual({
      "work-area": "/tmp/wa",
      "dry-run": true,
    });
  });

  it("parses short -o <file> flags (regression: -o was silently dropped, sending merged SARIF to stdout)", () => {
    expect(parseArgs(["--work-area", "/tmp/wa", "-o", "merged.sarif.json"])).toEqual({
      "work-area": "/tmp/wa",
      o: "merged.sarif.json",
    });
  });

  it("treats a short flag before another flag as boolean", () => {
    expect(parseArgs(["-v", "--dry-run"])).toEqual({ v: true, "dry-run": true });
  });

  it("does not mistake a negative-number value for a flag", () => {
    expect(parseArgs(["--offset", "-3"])).toEqual({ offset: "-3" });
  });

  it("ignores bare positionals", () => {
    expect(parseArgs(["positional", "--flag", "x"])).toEqual({ flag: "x" });
  });
});

describe("EXIT contract", () => {
  it("keeps the shared exit codes stable", () => {
    expect(EXIT).toMatchObject({ OK: 0, UNEXPECTED: 1, USAGE: 2, INVALID: 3, DRIFT: 4, PARTIAL: 5, FOREIGN_PENDING: 6 });
  });
});
