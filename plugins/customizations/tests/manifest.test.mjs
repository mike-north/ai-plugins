/**
 * Tests for the deterministic customization-manifest bookkeeping engine.
 *
 * Uses temp dirs via CUSTOMIZATIONS_HOME / CUSTOMIZATIONS_PROJECT_DIR env
 * overrides and fixed ISO date constants — no Date.now()/new Date() in test data.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addEntry,
  listEntries,
  getEntry,
  removeEntry,
  readConfig,
  writeConfig,
  getConfigValue,
  resolveUserDir,
  resolveProjectDir,
} from "../skills/customizations/scripts/manifest.mjs";

const FIXED_ISO = "2026-01-15T10:30:00.000Z";

/** @type {string} */
let userDir;
/** @type {string} */
let projectDir;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "cust-manifest-"));
  userDir = join(base, "user");
  projectDir = join(base, "project");
  mkdirSync(userDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  process.env["CUSTOMIZATIONS_HOME"] = userDir;
  process.env["CUSTOMIZATIONS_PROJECT_DIR"] = projectDir;
});

afterEach(() => {
  delete process.env["CUSTOMIZATIONS_HOME"];
  delete process.env["CUSTOMIZATIONS_PROJECT_DIR"];
});

/** A minimal valid entry payload. */
function sample(overrides = {}) {
  return {
    slug: "git-utilities",
    type: "skill",
    description: "Deterministic git utilities",
    scope: "user",
    components: [{ path: "~/.claude/skills/git/SKILL.md", action: "created", description: "the skill" }],
    ...overrides,
  };
}

describe("addEntry", () => {
  it("writes <slug>.json and applies defaults (status/assistant/created)", () => {
    const { writtenPath, entry } = addEntry(sample(), { now: FIXED_ISO });
    expect(writtenPath).toBe(join(resolveUserDir(), "git-utilities.json"));
    expect(entry.status).toBe("active");
    expect(entry.assistant).toBe("claude");
    expect(entry.created).toBe(FIXED_ISO);
    const onDisk = JSON.parse(readFileSync(writtenPath, "utf8"));
    expect(onDisk.slug).toBe("git-utilities");
    expect(onDisk.components).toHaveLength(1);
  });

  it("honors an explicit status and created", () => {
    const { entry } = addEntry(sample({ status: "proposed", created: FIXED_ISO }));
    expect(entry.status).toBe("proposed");
    expect(entry.created).toBe(FIXED_ISO);
  });

  it("refuses to overwrite an existing slug without force", () => {
    addEntry(sample(), { now: FIXED_ISO });
    expect(() => addEntry(sample(), { now: FIXED_ISO })).toThrowError(/already exists/i);
  });

  it("overwrites with force", () => {
    addEntry(sample({ description: "v1" }), { now: FIXED_ISO });
    const { entry } = addEntry(sample({ description: "v2" }), { force: true, now: FIXED_ISO });
    expect(entry.description).toBe("v2");
  });

  it("rejects a missing required field (negative)", () => {
    const bad = sample();
    delete bad.description;
    expect(() => addEntry(bad, { now: FIXED_ISO })).toThrowError(/required field.*description/i);
  });

  it("rejects an invalid slug (negative)", () => {
    expect(() => addEntry(sample({ slug: "Bad Slug" }), { now: FIXED_ISO })).toThrowError(/invalid slug/i);
  });

  it("rejects an invalid scope (negative)", () => {
    expect(() => addEntry(sample({ scope: "global" }), { now: FIXED_ISO })).toThrowError(/invalid scope/i);
  });

  it("rejects an invalid type (negative)", () => {
    expect(() => addEntry(sample({ type: "bogus" }), { now: FIXED_ISO })).toThrowError(/invalid type/i);
  });

  it("rejects an invalid status (negative)", () => {
    expect(() => addEntry(sample({ status: "archived" }), { now: FIXED_ISO })).toThrowError(/invalid status/i);
  });

  it("rejects non-array components (negative)", () => {
    expect(() => addEntry(sample({ components: "nope" }), { now: FIXED_ISO })).toThrowError(
      /components.*array/i,
    );
  });

  it("defaults origin to null and preserves a provided origin", () => {
    const { entry: local } = addEntry(sample({ slug: "local-one" }), { now: FIXED_ISO });
    expect(local.origin).toBeNull();
    const { entry: imported } = addEntry(
      sample({ slug: "imported-one", origin: "anthropics/skills" }),
      { now: FIXED_ISO },
    );
    expect(imported.origin).toBe("anthropics/skills");
  });
});

describe("listEntries", () => {
  it("filters by scope, includes resolvedScope + path", () => {
    addEntry(sample({ slug: "u-one", scope: "user" }), { now: FIXED_ISO });
    addEntry(sample({ slug: "p-one", scope: "project" }), { now: FIXED_ISO });

    const all = listEntries();
    expect(all.map((e) => e.slug).sort()).toEqual(["p-one", "u-one"]);

    const userOnly = listEntries({ scope: "user" });
    expect(userOnly).toHaveLength(1);
    expect(userOnly[0].resolvedScope).toBe("user");
    expect(userOnly[0].path).toBe(join(resolveUserDir(), "u-one.json"));
  });

  it("sorts deterministically (user scope before project, then slug)", () => {
    addEntry(sample({ slug: "zeta", scope: "user" }), { now: FIXED_ISO });
    addEntry(sample({ slug: "alpha", scope: "project" }), { now: FIXED_ISO });
    addEntry(sample({ slug: "beta", scope: "user" }), { now: FIXED_ISO });
    expect(listEntries().map((e) => e.slug)).toEqual(["beta", "zeta", "alpha"]);
  });

  it("filters by status and type", () => {
    addEntry(sample({ slug: "a", status: "active", type: "rule" }), { now: FIXED_ISO });
    addEntry(sample({ slug: "p", status: "proposed", type: "hook" }), { now: FIXED_ISO });
    expect(listEntries({ status: "proposed" }).map((e) => e.slug)).toEqual(["p"]);
    expect(listEntries({ type: "rule" }).map((e) => e.slug)).toEqual(["a"]);
  });

  it("backward-compat: legacy entry missing type/status is listed as unknown/active", () => {
    // Write a legacy file directly (no type, no status) — must not crash, must default.
    writeFileSync(
      join(resolveUserDir(), "legacy.json"),
      JSON.stringify({ slug: "legacy", description: "old", scope: "user", components: [] }),
      "utf8",
    );
    const [entry] = listEntries({ scope: "user" });
    expect(entry.type).toBe("unknown");
    expect(entry.status).toBe("active");
    expect(entry.origin).toBeNull();
  });

  it("excludes config.json from listings", () => {
    writeConfig("personalMarketplace.name", "my-plugins");
    expect(existsSync(join(resolveUserDir(), "config.json"))).toBe(true);
    expect(listEntries()).toHaveLength(0);
  });
});

describe("getEntry", () => {
  it("returns the entry when present", () => {
    addEntry(sample({ slug: "found-it" }), { now: FIXED_ISO });
    expect(getEntry("found-it").slug).toBe("found-it");
  });

  it("throws NOT_FOUND when absent (negative)", () => {
    expect(() => getEntry("nope")).toThrowError(/not found/i);
  });
});

describe("removeEntry", () => {
  it("deletes the manifest entry, returns components, leaves artifacts untouched", () => {
    // A real artifact file that must survive removal.
    const artifact = join(projectDir, "artifact.txt");
    writeFileSync(artifact, "keep me", "utf8");
    addEntry(
      sample({
        slug: "removable",
        scope: "user",
        components: [{ path: artifact, action: "created", description: "an artifact" }],
      }),
      { now: FIXED_ISO },
    );

    const removed = removeEntry("removable");
    expect(removed.components[0].path).toBe(artifact);
    expect(existsSync(join(resolveUserDir(), "removable.json"))).toBe(false);
    expect(existsSync(artifact)).toBe(true); // artifact NOT deleted by the manifest engine
  });

  it("throws NOT_FOUND when removing an absent slug (negative)", () => {
    expect(() => removeEntry("ghost")).toThrowError(/not found/i);
  });
});

describe("config", () => {
  it("readConfig returns {} when no config exists", () => {
    expect(readConfig()).toEqual({});
  });

  it("writeConfig + getConfigValue roundtrip with dotted keys", () => {
    writeConfig("personalMarketplace.path", "/abs/repo");
    writeConfig("personalMarketplace.name", "my-plugins");
    writeConfig("marketplaces.anthropics/skills", { role: "consumer", contribute: "none" });

    expect(getConfigValue("personalMarketplace.path")).toBe("/abs/repo");
    expect(getConfigValue("personalMarketplace.name")).toBe("my-plugins");
    expect(getConfigValue("marketplaces.anthropics/skills")).toEqual({
      role: "consumer",
      contribute: "none",
    });
    // whole config when no key
    expect(getConfigValue(undefined)).toMatchObject({
      personalMarketplace: { path: "/abs/repo", name: "my-plugins" },
    });
  });

  it("getConfigValue returns undefined for an unknown dotted path (negative)", () => {
    writeConfig("a.b", 1);
    expect(getConfigValue("a.c.d")).toBeUndefined();
  });
});
