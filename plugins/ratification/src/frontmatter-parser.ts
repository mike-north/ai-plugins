/**
 * Changeset frontmatter parsing — the strict-YAML-safe extraction step ahead of schema
 * validation.
 *
 * frontmatter-schema.md §"Carrier and serialization": the changeset header is a YAML frontmatter
 * block delimited by `---` fences, with the repo's **strict-YAML caveat**: any scalar containing
 * `: ` must be quoted (Codex strict-parses frontmatter). This module uses the `yaml` package
 * (the same parser `@ai-plugin-marketplace/core`'s lint engine parses skill/agent frontmatter
 * with) rather than a bespoke regex-based key/value splitter, so quoted scalars containing `: `
 * round-trip correctly instead of being mis-split at the first colon.
 *
 * @see docs/ratification/frontmatter-schema.md §"Carrier and serialization"
 */
import { parseDocument } from "yaml";

/**
 * Matches a YAML frontmatter block anchored to the start of the file (after an optional UTF-8
 * BOM), mirroring the pattern `@ai-plugin-marketplace/core`'s lint engine uses for skill/agent
 * frontmatter (`dist/lint/document.js`'s `FRONTMATTER_RE`) — no `m` flag, so a `---` thematic
 * break in the changeset body is never mistaken for the header fence.
 */
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export type ParsedChangeset =
  | { ok: true; header: unknown; body: string }
  | { ok: false; error: string };

/**
 * Extract and parse a changeset file's YAML frontmatter block.
 *
 * Fails closed: a missing frontmatter fence or a YAML syntax error both return `ok: false`
 * rather than guessing at partial content.
 */
export function parseChangesetFrontmatter(fileText: string): ParsedChangeset {
  const match = FRONTMATTER_RE.exec(fileText);
  if (!match) {
    return { ok: false, error: "No YAML frontmatter block found (missing leading `---` fence)." };
  }

  const yamlText = match[1] ?? "";
  const body = fileText.slice(match[0].length);

  const doc = parseDocument(yamlText, { strict: true });
  if (doc.errors.length > 0) {
    return { ok: false, error: doc.errors[0]?.message ?? "YAML parse error." };
  }

  return { ok: true, header: doc.toJS(), body };
}
