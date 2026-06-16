/**
 * Shared parsing for the YAML frontmatter of plugin agent/skill markdown files.
 *
 * The historical approach extracted fields with a naive single-line regex
 * (`^field:\s*(.+)$`). That regex cannot resolve YAML block scalars: a folded
 * (`description: >-`) or literal (`description: |-`) multi-line value left the
 * literal indicator token (`>-` / `|-`) as the captured value instead of the
 * real text — e.g. a generated Kiro agent JSON ended up with `"description": ">-"`.
 *
 * The naive regex was, however, *tolerant* of plain single-line values that are
 * not strictly valid YAML or whose YAML meaning differs from the author's
 * intent — most importantly an unquoted `" #"` (which YAML reads as the start of
 * a comment) and an unquoted `": "` (which YAML reads as a nested mapping). Real
 * agent descriptions routinely contain both (e.g. "… references the issue with
 * Refs #N." or "Use when: …"). A full YAML parse of every value would silently
 * truncate the former and reject the latter.
 *
 * So extraction is *targeted*: a value is resolved with the `yaml` parser only
 * when it is an actual block scalar (the one case the regex got wrong). Plain
 * and quoted single-line values keep the exact legacy single-line capture, so
 * their behavior is unchanged.
 */

import { parse as parseYaml } from "yaml";

/** Matches the leading `---` … `---` frontmatter block and captures its contents. */
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/m;

/**
 * Whether a raw value token is a YAML block-scalar header — folded (`>`) or
 * literal (`|`), optionally with chomping (`-`/`+`) and/or an indentation
 * indicator (a digit), optionally followed by a trailing comment.
 *
 * Examples that match: `>`, `>-`, `|+`, `|2`, `>-2`, `|2-`, `>- # note`.
 * A plain value that merely starts with `>` followed by text (e.g. `> note`)
 * does not match, so it keeps legacy single-line handling.
 */
function isBlockScalarHeader(rawValue: string): boolean {
  return /^[|>][0-9+-]*(\s+#.*)?$/.test(rawValue.trim());
}

/**
 * Extracts and YAML-parses the leading frontmatter block of a markdown document.
 *
 * @returns the parsed mapping, or `undefined` if there is no frontmatter, it is
 *   not valid YAML, or it does not parse to a plain object.
 */
export function parseFrontmatter(content: string): Record<string, unknown> | undefined {
  const fmMatch = FRONTMATTER_RE.exec(content);
  if (!fmMatch) return undefined;
  const frontmatter = fmMatch[1] ?? "";
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Reads a single string-valued frontmatter field.
 *
 * Folded (`>-`/`>`) and literal (`|-`/`|`) block scalars are resolved to their
 * text value via the `yaml` parser. Every other value (plain or quoted,
 * single-line) is returned exactly as the legacy single-line regex captured it,
 * preserving tolerance for unquoted `" #"` and `": "` in plain descriptions.
 */
export function parseFrontmatterField(content: string, field: string): string | undefined {
  const fmMatch = FRONTMATTER_RE.exec(content);
  if (!fmMatch) return undefined;
  const frontmatter = fmMatch[1] ?? "";

  const lineMatch = new RegExp(`^${field}:[ \\t]*(.*)$`, "m").exec(frontmatter);
  if (!lineMatch) return undefined;
  const rawValue = (lineMatch[1] ?? "").trim();

  if (isBlockScalarHeader(rawValue)) {
    // Resolve the indented block via YAML so the indicator token (`>-`/`|-`) is
    // replaced by the real multi-line text.
    let parsed: unknown;
    try {
      parsed = parseYaml(frontmatter);
    } catch {
      return undefined;
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>)[field];
      if (typeof value === "string") return value.trim();
    }
    // Could not resolve to a string — return undefined rather than the bogus
    // `>-`/`|-` indicator token.
    return undefined;
  }

  // Plain / quoted single-line value: legacy behavior.
  return rawValue.length > 0 ? rawValue : undefined;
}
