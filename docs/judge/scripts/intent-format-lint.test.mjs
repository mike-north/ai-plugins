/**
 * Tests for intent-format-lint.mjs — the structural conformance checker for
 * intent documents against docs/judge/intent-format.md.
 *
 * @see ../intent-format.md for the governing format spec
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkCitationResolvable,
  checkNoSlugReuseAcrossVersions,
  checkRetiredMarkerVersion,
  checkSequentialClauseNumbering,
  checkUniqueSlugsWithinDocument,
  checkVersionHeaderMatchesFilename,
  filenameVersion,
  lintIntentDocument,
  lintIntentDocumentSet,
  parseIntentDocument,
} from "./intent-format-lint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, "fixtures");
const INTENTS_DIR = path.join(HERE, "..", "intents");

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function fixtureDoc(name) {
  return { filename: name, content: readFixture(name) };
}

const V1 = readFixture("intents-v1.md");
const V2 = readFixture("intents-v2.md");

describe("filenameVersion", () => {
  it("extracts the version from a well-formed filename", () => {
    expect(filenameVersion("intents-v1.md")).toBe(1);
    expect(filenameVersion("/some/path/intents-v42.md")).toBe(42);
  });

  it("returns null for a non-conforming filename", () => {
    expect(filenameVersion("intents.md")).toBeNull();
    expect(filenameVersion("intents-1.md")).toBeNull();
  });
});

describe("parseIntentDocument", () => {
  it("extracts header version, principles, slugs, and clauses", () => {
    const parsed = parseIntentDocument(V1);
    expect(parsed.headerVersion).toBe(1);
    expect(parsed.principles.map((p) => p.slug)).toEqual(["ssh-always", "releases-are-mikes-gate"]);
    expect(parsed.principles[0].clauses.map((c) => c.number)).toEqual([1, 2, 3]);
  });

  it("captures a retired marker's version", () => {
    const parsed = parseIntentDocument(V2);
    const retired = parsed.principles.find((p) => p.slug === "releases-are-mikes-gate");
    expect(retired.retiredAtVersion).toBe(2);
    const active = parsed.principles.find((p) => p.slug === "ssh-always");
    expect(active.retiredAtVersion).toBeNull();
  });
});

describe("checkVersionHeaderMatchesFilename (criterion 1: version header vs. filename)", () => {
  it("passes when the header version matches the filename", () => {
    expect(checkVersionHeaderMatchesFilename(V1, "intents-v1.md")).toEqual([]);
  });

  it("fails when the header version does not match the filename [negative: version/filename mismatch]", () => {
    // V1's content declares "**Version**: 1" but is presented under a v2 filename.
    const errors = checkVersionHeaderMatchesFilename(V1, "intents-v2.md");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/does not match filename version/);
  });

  it("fails when the filename doesn't match the intents-v<N>.md pattern", () => {
    const errors = checkVersionHeaderMatchesFilename(V1, "intents.md");
    expect(errors.some((e) => e.includes("does not match the required intents-v<N>.md pattern"))).toBe(true);
  });

  it("fails when no version header is present", () => {
    const noHeader = "# Intent document\n\n## 1. `x`\n\n**Statement.**\n\n1. Clause.\n";
    const errors = checkVersionHeaderMatchesFilename(noHeader, "intents-v1.md");
    expect(errors.some((e) => e.includes('no "**Version**: <N>" header found'))).toBe(true);
  });
});

describe("checkUniqueSlugsWithinDocument (criterion 1: unique stable slugs)", () => {
  it("passes when all slugs in a document are unique", () => {
    expect(checkUniqueSlugsWithinDocument(V1, "intents-v1.md")).toEqual([]);
  });

  it("fails on a duplicate slug within the same document [negative: duplicate slug]", () => {
    const dup = `# Intent document

> **Version**: 1

## 1. \`ssh-always\`

**First.**

1. Clause one.

## 2. \`ssh-always\`

**Second, illegitimately reusing the same slug.**

1. Clause one.
`;
    const errors = checkUniqueSlugsWithinDocument(dup, "intents-v1.md");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/duplicate slug "ssh-always"/);
  });
});

describe("checkSequentialClauseNumbering (criterion 1: sequentially numbered clauses per principle)", () => {
  it("passes when clauses are numbered 1, 2, 3, ...", () => {
    expect(checkSequentialClauseNumbering(V1, "intents-v1.md")).toEqual([]);
  });

  it("fails when a clause number is missing/skipped [negative: missing clause number]", () => {
    const skip = `# Intent document

> **Version**: 1

## 1. \`ssh-always\`

**Statement.**

1. Clause one.
3. Clause three — clause two is missing.
`;
    const errors = checkSequentialClauseNumbering(skip, "intents-v1.md");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/expected clause 2, found 3/);
  });

  it("fails when a principle has no numbered clauses at all", () => {
    const empty = `# Intent document

> **Version**: 1

## 1. \`ssh-always\`

**Statement with no clauses.**
`;
    const errors = checkSequentialClauseNumbering(empty, "intents-v1.md");
    expect(errors.some((e) => e.includes("has no numbered clauses"))).toBe(true);
  });
});

describe("checkRetiredMarkerVersion (criterion 1: a principle cannot be retired at a version that doesn't exist yet)", () => {
  it("passes when the retired marker's version does not exceed the document's own version", () => {
    expect(checkRetiredMarkerVersion(V2, "intents-v2.md")).toEqual([]);
  });

  it("fails when a principle declares retirement at a version later than its own document [negative: future-dated retirement marker]", () => {
    // Fixture file is named "...-future-retired.md" for readability on disk;
    // its own "**Version**: 2" header is what matters, so it's checked
    // under the logical filename "intents-v2.md".
    const futureRetiredContent = readFixture("intents-v2-future-retired.md");
    const errors = checkRetiredMarkerVersion(futureRetiredContent, "intents-v2.md");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/declares "\*\*Retired\*\*: v5", a version that doesn't exist yet/);
  });
});

describe("lintIntentDocument (aggregates single-document checks)", () => {
  it("returns no errors for a well-formed document", () => {
    expect(lintIntentDocument({ filename: "intents-v1.md", content: V1 }).errors).toEqual([]);
    expect(lintIntentDocument({ filename: "intents-v2.md", content: V2 }).errors).toEqual([]);
  });
});

describe("checkNoSlugReuseAcrossVersions (criterion 1: no slug reuse across a supplied set of versions)", () => {
  it("passes across a well-formed version set (amendment + retirement + new slug)", () => {
    const errors = checkNoSlugReuseAcrossVersions([fixtureDoc("intents-v1.md"), fixtureDoc("intents-v2.md")]);
    expect(errors).toEqual([]);
  });

  it("fails when a later version reuses a slug retired in an earlier version [negative: slug reuse across versions]", () => {
    const errors = checkNoSlugReuseAcrossVersions([
      fixtureDoc("intents-v1.md"),
      fixtureDoc("intents-v2.md"),
      fixtureDoc("intents-v3.md"),
    ]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/slug "releases-are-mikes-gate" was retired at v2 but reappears/);
  });

  it("is order-independent — the same violation is found regardless of input array order", () => {
    const errors = checkNoSlugReuseAcrossVersions([
      fixtureDoc("intents-v3.md"),
      fixtureDoc("intents-v1.md"),
      fixtureDoc("intents-v2.md"),
    ]);
    expect(errors.length).toBe(1);
  });

  it("still catches resurrection when the retirement marker itself is future-dated (malformed) [regression: fail-open on trusted retirement version]", () => {
    // intents-v2-future-retired.md declares "**Retired**: v5" inside a v2
    // document. If checkNoSlugReuseAcrossVersions trusted that declared
    // value verbatim, v3 > 5 would be false and the reuse below would go
    // undetected — the exact fail-open this check exists to prevent. It
    // must instead anchor retirement to the declaring document's own
    // version (v2), so v3 > 2 still fires.
    const v2FutureRetired = { filename: "intents-v2.md", content: readFixture("intents-v2-future-retired.md") };
    const errors = checkNoSlugReuseAcrossVersions([v2FutureRetired, fixtureDoc("intents-v3.md")]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/slug "releases-are-mikes-gate" was retired at v2 but reappears/);
  });
});

describe("lintIntentDocumentSet (aggregates all criterion-1 checks across versions)", () => {
  it("passes for the well-formed v1/v2 set", () => {
    expect(lintIntentDocumentSet([fixtureDoc("intents-v1.md"), fixtureDoc("intents-v2.md")]).errors).toEqual([]);
  });

  it("surfaces both a per-document error and a cross-version reuse error together", () => {
    const badVersion = { filename: "intents-v9.md", content: V1 }; // header says v1, filename says v9
    const { errors } = lintIntentDocumentSet([
      badVersion,
      fixtureDoc("intents-v2.md"),
      fixtureDoc("intents-v3.md"),
    ]);
    expect(errors.some((e) => e.includes("does not match filename version"))).toBe(true);
    expect(errors.some((e) => e.includes("was retired at v2 but reappears"))).toBe(true);
  });
});

describe("checkCitationResolvable (criterion 2: citation resolvability)", () => {
  const docs = [fixtureDoc("intents-v1.md"), fixtureDoc("intents-v2.md")];

  it("resolves a citation whose version, slug, and clause all exist [positive]", () => {
    const result = checkCitationResolvable({ id: "ssh-always", version: "1", sections: ["1", "2"] }, docs);
    expect(result).toEqual({ resolvable: true, reason: null });
  });

  it("resolves a citation against an amended (v2) clause set [positive]", () => {
    const result = checkCitationResolvable({ id: "ssh-always", version: "2", sections: ["3"] }, docs);
    expect(result.resolvable).toBe(true);
  });

  it("is unresolvable when the cited version does not exist [negative]", () => {
    const result = checkCitationResolvable({ id: "ssh-always", version: "99", sections: ["1"] }, docs);
    expect(result.resolvable).toBe(false);
    expect(result.reason).toMatch(/version "99" does not exist/);
  });

  it("is unresolvable when the version exists but does not contain the slug [negative]", () => {
    const result = checkCitationResolvable({ id: "no-such-principle", version: "1", sections: ["1"] }, docs);
    expect(result.resolvable).toBe(false);
    expect(result.reason).toMatch(/does not contain slug "no-such-principle"/);
  });

  it("is unresolvable when the slug exists but the cited clause does not [negative]", () => {
    const result = checkCitationResolvable({ id: "ssh-always", version: "1", sections: ["1", "99"] }, docs);
    expect(result.resolvable).toBe(false);
    expect(result.reason).toMatch(/does not contain clause "99"/);
  });

  it("is unresolvable when a slug introduced in a later version is cited against an earlier version [negative]", () => {
    // secrets-stay-in-1password is introduced in v2 and does not exist in v1.
    const result = checkCitationResolvable({ id: "secrets-stay-in-1password", version: "1", sections: ["1"] }, docs);
    expect(result.resolvable).toBe(false);
    expect(result.reason).toMatch(/version "1" does not contain slug "secrets-stay-in-1password"/);
  });
});

// Resolved once, at collection time, so the "no ratified intents yet" state
// is visible in the test report as an explicit skip rather than a silently
// passing assertion (nothing here would fail either way today, since
// docs/judge/intents/ doesn't exist on main yet).
const realIntentFiles = fs.existsSync(INTENTS_DIR)
  ? fs
      .readdirSync(INTENTS_DIR)
      .filter((f) => /^intents-v\d+\.md$/.test(f))
      .map((f) => path.join(INTENTS_DIR, f))
  : [];

describe("real, shipped intent documents (if any have been ratified into the repo)", () => {
  it.skipIf(realIntentFiles.length === 0)(
    "conform to the format — zero structural errors",
    () => {
      const docs = realIntentFiles.map((filename) => ({ filename, content: fs.readFileSync(filename, "utf8") }));
      const { errors } = lintIntentDocumentSet(docs);
      expect(errors).toEqual([]);
    },
  );

  it("names the current state explicitly, so a skip above isn't mistaken for coverage", () => {
    if (realIntentFiles.length === 0) {
      expect(fs.existsSync(INTENTS_DIR), "docs/judge/intents/ does not exist yet — no ratified intent documents to check").toBe(
        false,
      );
    } else {
      expect(realIntentFiles.length).toBeGreaterThan(0);
    }
  });
});
