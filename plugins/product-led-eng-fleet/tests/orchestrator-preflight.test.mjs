/**
 * Tests for the deterministic orchestrator preflight gate.
 *
 * Pure logic is exercised with injected inputs (no git/fs needed), covering the
 * happy path plus the validation/negative cases the gate exists to catch:
 * primary-checkout, missing/forbidden plugins, malformed markers, settings precedence.
 */
import { describe, expect, it } from "vitest";

import {
  isEnabledValue,
  parseMarker,
  computeEnabledPlugins,
  checkLinkedWorktree,
  runPreflight,
} from "../skills/product-led-eng-fleet/scripts/orchestrator-preflight.mjs";

const ENG_MARKER = { role: "eng", require: ["product-led-eng-fleet", "github-fleet-tools"], forbid: ["github-fleet-pm"] };

describe("isEnabledValue", () => {
  it("treats true and non-empty version arrays as enabled", () => {
    expect(isEnabledValue(true)).toBe(true);
    expect(isEnabledValue(["^1.0.0"])).toBe(true);
  });
  it("treats false / empty / nullish as disabled (negative)", () => {
    expect(isEnabledValue(false)).toBe(false);
    expect(isEnabledValue([])).toBe(false);
    expect(isEnabledValue(undefined)).toBe(false);
    expect(isEnabledValue(null)).toBe(false);
  });
});

describe("parseMarker", () => {
  it("parses a valid marker and defaults require/forbid to []", () => {
    expect(parseMarker('{"role":"eng"}')).toEqual({ role: "eng", require: [], forbid: [] });
    expect(parseMarker(JSON.stringify(ENG_MARKER))).toEqual(ENG_MARKER);
  });
  it("trims the role", () => {
    expect(parseMarker('{"role":"  pm  "}').role).toBe("pm");
  });
  it("rejects invalid JSON (negative)", () => {
    expect(() => parseMarker("{not json")).toThrowError(/not valid JSON/i);
  });
  it("rejects a non-object top level (negative)", () => {
    expect(() => parseMarker("[]")).toThrowError(/must be a JSON object/i);
    expect(() => parseMarker('"eng"')).toThrowError(/must be a JSON object/i);
  });
  it("rejects a missing/blank role (negative)", () => {
    expect(() => parseMarker("{}")).toThrowError(/"role" must be a non-empty string/i);
    expect(() => parseMarker('{"role":"   "}')).toThrowError(/"role" must be a non-empty string/i);
  });
  it("rejects non-string-array require/forbid (negative)", () => {
    expect(() => parseMarker('{"role":"eng","require":"x"}')).toThrowError(/"require" must be an array/i);
    expect(() => parseMarker('{"role":"eng","forbid":[1]}')).toThrowError(/"forbid" must be an array/i);
  });
});

describe("computeEnabledPlugins", () => {
  it("extracts bare names from name@marketplace keys", () => {
    const enabled = computeEnabledPlugins([
      { enabledPlugins: { "product-led-eng-fleet@ai-plugins": true, "github-fleet-tools@ai-plugins": true } },
    ]);
    expect([...enabled].sort()).toEqual(["github-fleet-tools", "product-led-eng-fleet"]);
  });
  it("applies precedence: a later source disabling a plugin wins (negative override)", () => {
    const enabled = computeEnabledPlugins([
      { enabledPlugins: { "github-fleet-pm@ai-plugins": true } }, // user enables
      { enabledPlugins: { "github-fleet-pm@ai-plugins": false } }, // project disables
    ]);
    expect(enabled.has("github-fleet-pm")).toBe(false);
  });
  it("ignores missing / non-object enabledPlugins", () => {
    expect(computeEnabledPlugins([{}, { enabledPlugins: null }, {}]).size).toBe(0);
  });
});

describe("checkLinkedWorktree", () => {
  it("passes when worktree git dir differs from the common dir", () => {
    expect(checkLinkedWorktree("/repo/.git/worktrees/eng", "/repo/.git")).toBeNull();
  });
  it("fails in the primary checkout where the dirs are equal (negative)", () => {
    expect(checkLinkedWorktree("/repo/.git", "/repo/.git")).toMatch(/PRIMARY checkout/i);
  });
  it("fails when git dirs are unknown (negative)", () => {
    expect(checkLinkedWorktree(null, null)).toMatch(/not inside a git repository/i);
  });
});

describe("runPreflight", () => {
  const linked = { gitDir: "/repo/.git/worktrees/eng", commonDir: "/repo/.git" };

  it("passes when worktree is linked, required plugins on, forbidden off", () => {
    const v = runPreflight({
      ...linked,
      marker: ENG_MARKER,
      enabledNames: new Set(["product-led-eng-fleet", "github-fleet-tools"]),
    });
    expect(v).toEqual({ ok: true, role: "eng", violations: [] });
  });

  it("fails in the primary checkout (negative)", () => {
    const v = runPreflight({
      gitDir: "/repo/.git",
      commonDir: "/repo/.git",
      marker: ENG_MARKER,
      enabledNames: new Set(["product-led-eng-fleet", "github-fleet-tools"]),
    });
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => /PRIMARY checkout/i.test(x))).toBe(true);
  });

  it("fails when a required plugin is not enabled (negative)", () => {
    const v = runPreflight({
      ...linked,
      marker: ENG_MARKER,
      enabledNames: new Set(["product-led-eng-fleet"]), // missing github-fleet-tools
    });
    expect(v.ok).toBe(false);
    expect(v.violations).toContain("required plugin not enabled: github-fleet-tools");
  });

  it("fails when a forbidden (off-role) plugin is enabled (negative)", () => {
    const v = runPreflight({
      ...linked,
      marker: ENG_MARKER,
      enabledNames: new Set(["product-led-eng-fleet", "github-fleet-tools", "github-fleet-pm"]),
    });
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => /forbidden plugin is enabled.*github-fleet-pm/i.test(x))).toBe(true);
  });

  it("aggregates multiple violations rather than short-circuiting", () => {
    const v = runPreflight({
      gitDir: "/repo/.git",
      commonDir: "/repo/.git", // primary checkout
      marker: ENG_MARKER,
      enabledNames: new Set(["github-fleet-pm"]), // missing both required, forbidden present
    });
    expect(v.ok).toBe(false);
    // primary-checkout + 2 missing required + 1 forbidden = 4
    expect(v.violations.length).toBe(4);
  });
});
