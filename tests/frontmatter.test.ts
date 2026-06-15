/**
 * Tests for src/frontmatter.ts — frontmatter field extraction with YAML
 * block-scalar support.
 *
 * @see https://yaml.org/spec/1.2.2/#812-literal-style — literal `|` block scalars
 * @see https://yaml.org/spec/1.2.2/#813-folded-style — folded `>` block scalars
 */

import { describe, expect, it } from "vitest";
import { parseFrontmatter, parseFrontmatterField } from "../src/frontmatter.js";

const md = String.raw;

describe("parseFrontmatterField", () => {
  it("extracts a plain single-line scalar", () => {
    const content = md`---
name: my-agent
description: A simple description
---
# Body`;
    expect(parseFrontmatterField(content, "name")).toBe("my-agent");
    expect(parseFrontmatterField(content, "description")).toBe("A simple description");
  });

  // Regression: folded (`>-`) block scalars previously yielded the literal ">-"
  // token instead of the resolved text (Kiro JSON got `"description": ">-"`).
  it("resolves a folded (>-) block scalar to its joined text", () => {
    const content = md`---
name: my-agent
description: >-
  First line of the
  folded description.
tools:
  - Read
---
# Body`;
    expect(parseFrontmatterField(content, "description")).toBe("First line of the folded description.");
  });

  // Regression: literal (`|-`) block scalars must keep newlines, not yield "|-".
  it("resolves a literal (|-) block scalar preserving newlines", () => {
    const content = md`---
name: my-agent
description: |-
  Line one
  line two
---
# Body`;
    expect(parseFrontmatterField(content, "description")).toBe("Line one\nline two");
  });

  it("never returns the block-scalar indicator token", () => {
    for (const indicator of [">-", ">", "|-", "|"]) {
      const content = `---\nname: a\ndescription: ${indicator}\n  Real text here.\n---\n`;
      const result = parseFrontmatterField(content, "description");
      expect(result).not.toBe(indicator);
      expect(result).toBe("Real text here.");
    }
  });

  it("returns single-line scalar values verbatim (version-like, numeric)", () => {
    const content = md`---
name: a
version: 1.0.0
count: 3
---`;
    expect(parseFrontmatterField(content, "version")).toBe("1.0.0");
    expect(parseFrontmatterField(content, "count")).toBe("3");
  });

  // Regression (CI-caught): a plain scalar containing an unquoted " #" must be
  // preserved in full. YAML reads " #" as the start of a comment, which would
  // silently truncate the description (e.g. "… with Refs #N. Stops …" → "… with
  // Refs"). Plain scalars must keep the legacy single-line capture.
  it("preserves an unquoted '#' in a plain scalar (not a YAML comment)", () => {
    const content = md`---
name: a
description: References the issue with Refs #N. Stops at PR-open.
---`;
    expect(parseFrontmatterField(content, "description")).toBe(
      "References the issue with Refs #N. Stops at PR-open.",
    );
  });

  it("returns undefined for a missing field", () => {
    const content = md`---
name: a
---`;
    expect(parseFrontmatterField(content, "description")).toBeUndefined();
  });

  it("returns undefined when there is no frontmatter", () => {
    expect(parseFrontmatterField("# Just a body", "description")).toBeUndefined();
  });

  // No-regression: a plain scalar containing an unquoted ": " is invalid YAML
  // (it reads as a nested mapping), but the legacy single-line capture tolerated
  // it. Plain scalars must keep that capture rather than dropping the field.
  it("preserves an unquoted ': ' in a plain scalar", () => {
    const content = md`---
name: a
description: Use when: the user asks for X
---`;
    expect(parseFrontmatterField(content, "description")).toBe("Use when: the user asks for X");
  });
});

describe("parseFrontmatter", () => {
  it("parses the whole frontmatter mapping", () => {
    const content = md`---
name: a
description: hello
---
body`;
    expect(parseFrontmatter(content)).toEqual({ name: "a", description: "hello" });
  });

  it("returns undefined when frontmatter is absent", () => {
    expect(parseFrontmatter("no frontmatter")).toBeUndefined();
  });

  it("returns undefined for invalid YAML", () => {
    const content = md`---
name: a
description: Use when: bad
---`;
    expect(parseFrontmatter(content)).toBeUndefined();
  });
});
