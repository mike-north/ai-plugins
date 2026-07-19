#!/usr/bin/env node
// intent-format-lint — mechanical conformance checker for intent documents
// against docs/judge/intent-format.md.
//
// Non-goal: this script has NO opinion on intent *content* (which principles
// exist, what they say, whether an intent is a good idea). It only checks
// document *structure*: version header vs. filename, slug uniqueness and
// permanence, sequential clause numbering, and citation resolvability. Any
// well-formed set of principles/clauses passes regardless of what they say.
//
// Retirement-marker convention: the format doc ("Optionally, a retired
// marker with the version at which retirement was ratified") doesn't pin an
// exact syntax, so this checker defines the concrete form as part of
// implementing the format: a line of the shape
//
//   **Retired**: v<N>
//
// appearing anywhere in a principle's block, where <N> is the intent-document
// version at which the retirement was ratified.
//
// Usage (CLI):
//   node intent-format-lint.mjs <intents-vN.md> [<intents-vM.md> ...]
//
// Exits 3 on any structural error, 0 otherwise.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HEADING_RE = /^##\s+(\d+)\.\s+`([^`]+)`\s*$/;
const VERSION_HEADER_RE = /\*\*Version\*\*:\s*(\d+)/;
const FILENAME_RE = /^intents-v(\d+)\.md$/;
const CLAUSE_RE = /^(\d+)\.\s+(.*)$/;
const RETIRED_RE = /\*\*Retired\*\*:\s*v(\d+)/;

/**
 * Extract the document version encoded in a filename like "intents-v3.md".
 * @param {string} filename
 * @returns {number|null}
 */
export function filenameVersion(filename) {
  const base = path.basename(filename);
  const m = FILENAME_RE.exec(base);
  return m ? Number(m[1]) : null;
}

/**
 * Parse an intent document's structure. This is a pure, permissive
 * extraction — it never throws; malformed input just produces principals
 * with fewer/odd fields, and the check functions below turn that into
 * errors.
 *
 * @param {string} content
 * @returns {{
 *   headerVersion: number|null,
 *   principles: Array<{
 *     number: number,
 *     slug: string,
 *     statement: string|null,
 *     clauses: Array<{number: number, text: string}>,
 *     retiredAtVersion: number|null,
 *   }>,
 * }}
 */
export function parseIntentDocument(content) {
  const lines = content.split(/\r?\n/);

  // Header version: search only the text before the first principle heading.
  const firstHeadingLineIdx = lines.findIndex((l) => HEADING_RE.test(l));
  const headerText = lines.slice(0, firstHeadingLineIdx === -1 ? lines.length : firstHeadingLineIdx).join("\n");
  const headerMatch = VERSION_HEADER_RE.exec(headerText);
  const headerVersion = headerMatch ? Number(headerMatch[1]) : null;

  // Collect heading indices to slice principle blocks.
  const headingIdxs = [];
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) headingIdxs.push(i);
  }

  const principles = [];
  for (let h = 0; h < headingIdxs.length; h++) {
    const idx = headingIdxs[h];
    const nextIdx = h + 1 < headingIdxs.length ? headingIdxs[h + 1] : lines.length;
    const headingMatch = HEADING_RE.exec(lines[idx]);
    const number = Number(headingMatch[1]);
    const slug = headingMatch[2];
    const blockLines = lines.slice(idx + 1, nextIdx);
    const blockText = blockLines.join("\n");

    const statementMatch = /^\*\*(.+)\*\*\s*$/m.exec(blockText);
    const statement = statementMatch ? statementMatch[1] : null;

    const clauses = [];
    for (const line of blockLines) {
      const cm = CLAUSE_RE.exec(line);
      if (cm) clauses.push({ number: Number(cm[1]), text: cm[2] });
    }

    const retiredMatch = RETIRED_RE.exec(blockText);
    const retiredAtVersion = retiredMatch ? Number(retiredMatch[1]) : null;

    principles.push({ number, slug, statement, clauses, retiredAtVersion });
  }

  return { headerVersion, principles };
}

/**
 * Check 1a: the document's header version matches the version encoded in
 * its filename.
 * @param {string} content
 * @param {string} filename
 * @returns {string[]} errors
 */
export function checkVersionHeaderMatchesFilename(content, filename) {
  const errors = [];
  const fromFilename = filenameVersion(filename);
  const { headerVersion } = parseIntentDocument(content);

  if (fromFilename === null) {
    errors.push(`filename "${path.basename(filename)}" does not match the required intents-v<N>.md pattern`);
  }
  if (headerVersion === null) {
    errors.push(`no "**Version**: <N>" header found before the first principle`);
  }
  if (fromFilename !== null && headerVersion !== null && fromFilename !== headerVersion) {
    errors.push(
      `version header (${headerVersion}) does not match filename version (${fromFilename}) in "${path.basename(filename)}"`,
    );
  }
  return errors;
}

/**
 * Check 1b: every principle's slug is unique within the document.
 * @param {string} content
 * @param {string} filename
 * @returns {string[]} errors
 */
export function checkUniqueSlugsWithinDocument(content, filename) {
  const errors = [];
  const { principles } = parseIntentDocument(content);
  const seen = new Map();
  for (const p of principles) {
    if (seen.has(p.slug)) {
      errors.push(`duplicate slug "${p.slug}" in "${path.basename(filename)}" (principles ${seen.get(p.slug)} and ${p.number})`);
    } else {
      seen.set(p.slug, p.number);
    }
  }
  return errors;
}

/**
 * Check 1c: each principle's clauses are numbered sequentially starting at 1
 * (1, 2, 3, ... — no gaps, no reordering, no duplicates).
 * @param {string} content
 * @param {string} filename
 * @returns {string[]} errors
 */
export function checkSequentialClauseNumbering(content, filename) {
  const errors = [];
  const { principles } = parseIntentDocument(content);
  for (const p of principles) {
    if (p.clauses.length === 0) {
      errors.push(`principle "${p.slug}" in "${path.basename(filename)}" has no numbered clauses`);
      continue;
    }
    for (let i = 0; i < p.clauses.length; i++) {
      const expected = i + 1;
      if (p.clauses[i].number !== expected) {
        errors.push(
          `principle "${p.slug}" in "${path.basename(filename)}" has non-sequential clause numbering: expected clause ${expected}, found ${p.clauses[i].number}`,
        );
      }
    }
  }
  return errors;
}

/**
 * Run all single-document structural checks (criteria 1a-1c).
 * @param {{filename: string, content: string}} doc
 * @returns {{errors: string[]}}
 */
export function lintIntentDocument({ filename, content }) {
  const errors = [
    ...checkVersionHeaderMatchesFilename(content, filename),
    ...checkUniqueSlugsWithinDocument(content, filename),
    ...checkSequentialClauseNumbering(content, filename),
  ];
  return { errors };
}

/**
 * Check 1d: no slug is reused across a supplied set of document versions.
 * Per the format doc's lifecycle section, retirement is terminal and "the
 * slug stays reserved" — so once a slug is retired (marked with
 * `**Retired**: v<N>`) at version N, it must never appear as an active
 * (non-retired) principle in any later version.
 *
 * @param {Array<{filename: string, content: string}>} docs
 * @returns {string[]} errors
 */
export function checkNoSlugReuseAcrossVersions(docs) {
  const errors = [];
  const parsed = docs
    .map((d) => ({ ...d, version: filenameVersion(d.filename), ...parseIntentDocument(d.content) }))
    .filter((d) => d.version !== null)
    .sort((a, b) => a.version - b.version);

  const retiredAt = new Map(); // slug -> version it was retired at

  for (const doc of parsed) {
    for (const p of doc.principles) {
      const priorRetirement = retiredAt.get(p.slug);
      if (priorRetirement !== undefined && doc.version > priorRetirement && p.retiredAtVersion === null) {
        errors.push(
          `slug "${p.slug}" was retired at v${priorRetirement} but reappears as an active principle in "${path.basename(doc.filename)}" (v${doc.version})`,
        );
      }
      if (p.retiredAtVersion !== null && !retiredAt.has(p.slug)) {
        retiredAt.set(p.slug, p.retiredAtVersion);
      }
    }
  }

  return errors;
}

/**
 * Run all checks (1a-1d) over a supplied set of intent document versions.
 * @param {Array<{filename: string, content: string}>} docs
 * @returns {{errors: string[]}}
 */
export function lintIntentDocumentSet(docs) {
  const errors = [];
  for (const doc of docs) errors.push(...lintIntentDocument(doc).errors);
  errors.push(...checkNoSlugReuseAcrossVersions(docs));
  return { errors };
}

/**
 * Check 2: citation resolvability, per intent-format.md §"Mapping to the
 * changeset frontmatter": "A citation is resolvable iff the named version
 * exists, contains the slug, and contains each cited clause number."
 *
 * @param {{id: string, version: string, sections: string[]}} citation
 * @param {Array<{filename: string, content: string}>} docs  the known set of intent documents
 * @returns {{resolvable: boolean, reason: string|null}}
 */
export function checkCitationResolvable(citation, docs) {
  const wantVersion = Number(citation.version);
  const doc = docs.find((d) => filenameVersion(d.filename) === wantVersion);
  if (!doc) {
    return { resolvable: false, reason: `version "${citation.version}" does not exist` };
  }

  const { principles } = parseIntentDocument(doc.content);
  const principle = principles.find((p) => p.slug === citation.id);
  if (!principle) {
    return { resolvable: false, reason: `version "${citation.version}" does not contain slug "${citation.id}"` };
  }

  const clauseNumbers = new Set(principle.clauses.map((c) => String(c.number)));
  for (const section of citation.sections) {
    if (!clauseNumbers.has(String(section))) {
      return {
        resolvable: false,
        reason: `slug "${citation.id}" in version "${citation.version}" does not contain clause "${section}"`,
      };
    }
  }

  return { resolvable: true, reason: null };
}

function readDocs(filenames) {
  return filenames.map((filename) => ({ filename, content: fs.readFileSync(filename, "utf8") }));
}

function main() {
  const filenames = process.argv.slice(2);
  if (filenames.length === 0) {
    process.stderr.write("usage: intent-format-lint.mjs <intents-vN.md> [<intents-vM.md> ...]\n");
    process.exit(2);
  }

  const docs = readDocs(filenames);
  const { errors } = lintIntentDocumentSet(docs);

  for (const e of errors) process.stderr.write(`ERROR: ${e}\n`);

  if (errors.length > 0) {
    process.stderr.write(`\n${errors.length} error(s)\n`);
    process.exit(3);
  }
  process.stdout.write(`0 errors across ${docs.length} document(s)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
