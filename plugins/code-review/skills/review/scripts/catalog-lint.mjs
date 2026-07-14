#!/usr/bin/env node
// catalog-lint — validate the lens/pack catalog's structural invariants.
//
// Deterministic checks only, no LLM calls. Exits 3 if any error is found,
// 0 otherwise (warnings are printed but don't fail the build).
//
// Usage:
//   node catalog-lint.mjs [--lenses-dir <dir>] [--packs-dir <dir>]

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./route-lenses.mjs";

const MAX_LENS_WORDS = 1200;
const MAX_PACK_WORDS = 600;
const PACK_STALE_MONTHS = 12;
const CHARTER_SIMILARITY_WARNING = 0.4;

function wordCount(text) {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

function bodyOf(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** Jaccard similarity of two charters' token sets. */
function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function monthsSince(dateStr) {
  const then = new Date(`${dateStr}-01T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return Infinity;
  const now = new Date();
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}

function lintLens(name, content, errors, warnings) {
  let fm;
  try {
    fm = parseFrontmatter(content);
  } catch (e) {
    errors.push(`${name}: invalid frontmatter (${e.message})`);
    return null;
  }

  for (const required of ["lens", "description", "charter", "route"]) {
    if (!fm[required] || String(fm[required]).trim() === "") {
      errors.push(`${name}: missing required field "${required}"`);
    }
  }

  if (fm.route === "auto" && (!Array.isArray(fm.match) || fm.match.length === 0)) {
    errors.push(`${name}: route "auto" requires a non-empty "match" list`);
  }
  if (fm.route === "judgment" && (!fm.summon || String(fm.summon).trim() === "")) {
    errors.push(`${name}: route "judgment" requires a non-empty "summon"`);
  }
  if (fm.route && !["always", "auto", "judgment"].includes(fm.route)) {
    errors.push(`${name}: unknown route "${fm.route}" (expected always|auto|judgment)`);
  }

  const body = bodyOf(content);
  if (!/##\s*do not comment on/i.test(body)) {
    errors.push(`${name}: body is missing a "## Do NOT comment on" scope fence`);
  }

  const words = wordCount(body);
  if (words > MAX_LENS_WORDS) {
    errors.push(`${name}: body is ${words} words, exceeds the ${MAX_LENS_WORDS}-word limit`);
  }

  return fm;
}

function lintPack(name, content, lensIds, errors, warnings) {
  let fm;
  try {
    fm = parseFrontmatter(content);
  } catch (e) {
    errors.push(`${name}: invalid frontmatter (${e.message})`);
    return null;
  }

  for (const required of ["pack", "loads_into", "verified"]) {
    if (fm[required] == null || (Array.isArray(fm[required]) && fm[required].length === 0)) {
      errors.push(`${name}: missing required field "${required}"`);
    }
  }

  if (Array.isArray(fm.loads_into)) {
    for (const target of fm.loads_into) {
      if (!lensIds.has(target)) {
        errors.push(`${name}: loads_into references unknown lens "${target}"`);
      }
    }
  }

  if (fm.verified && monthsSince(fm.verified) > PACK_STALE_MONTHS) {
    warnings.push(`${name}: verified "${fm.verified}" is more than ${PACK_STALE_MONTHS} months old`);
  }

  const body = bodyOf(content);
  const words = wordCount(body);
  if (words > MAX_PACK_WORDS) {
    errors.push(`${name}: body is ${words} words, exceeds the ${MAX_PACK_WORDS}-word limit`);
  }

  return fm;
}

/**
 * Lint the lens/pack catalog.
 * @param {{ lensesDir: string, packsDir: string }} dirs
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function lintCatalog({ lensesDir, packsDir }) {
  const errors = [];
  const warnings = [];

  let lensFiles = [];
  try {
    lensFiles = fs.readdirSync(lensesDir).filter((n) => n.endsWith(".md"));
  } catch {
    errors.push(`lenses directory not found: ${lensesDir}`);
    return { errors, warnings };
  }

  let packFiles = [];
  try {
    packFiles = fs.readdirSync(packsDir).filter((n) => n.endsWith(".md"));
  } catch {
    packFiles = [];
  }
  const packIds = new Set(packFiles.map((f) => f.replace(/\.md$/, "")));

  const lensCharters = [];
  const lensIds = new Set(lensFiles.map((f) => f.replace(/\.md$/, "")));

  for (const file of lensFiles.sort()) {
    const content = fs.readFileSync(path.join(lensesDir, file), "utf8");
    const fm = lintLens(file, content, errors, warnings);
    if (!fm) continue;
    if (fm.charter) lensCharters.push({ name: fm.lens ?? file, charter: fm.charter });

    for (const p of fm.packs ?? []) {
      if (p.id?.startsWith("skill:")) continue; // existence-checked at runtime, not here
      if (!packIds.has(p.id)) {
        errors.push(`${file}: packs reference unknown pack "${p.id}"`);
      }
    }
  }

  for (const file of packFiles.sort()) {
    const content = fs.readFileSync(path.join(packsDir, file), "utf8");
    lintPack(file, content, lensIds, errors, warnings);
  }

  for (let i = 0; i < lensCharters.length; i++) {
    for (let j = i + 1; j < lensCharters.length; j++) {
      const sim = jaccardSimilarity(lensCharters[i].charter, lensCharters[j].charter);
      if (sim > CHARTER_SIMILARITY_WARNING) {
        warnings.push(
          `charters for "${lensCharters[i].name}" and "${lensCharters[j].name}" are ${(sim * 100).toFixed(0)}% similar (possible overlap)`,
        );
      }
    }
  }

  return { errors, warnings };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lenses-dir") args.lensesDir = argv[++i];
    else if (a === "--packs-dir") args.packsDir = argv[++i];
  }
  return args;
}

function defaultDirs() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return { lensesDir: path.join(here, "..", "lenses"), packsDir: path.join(here, "..", "packs") };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const defaults = defaultDirs();
  const lensesDir = args.lensesDir ? path.resolve(args.lensesDir) : defaults.lensesDir;
  const packsDir = args.packsDir ? path.resolve(args.packsDir) : defaults.packsDir;

  const { errors, warnings } = lintCatalog({ lensesDir, packsDir });

  for (const w of warnings) process.stdout.write(`WARN: ${w}\n`);
  for (const e of errors) process.stderr.write(`ERROR: ${e}\n`);

  if (errors.length > 0) {
    process.stderr.write(`\n${errors.length} error(s), ${warnings.length} warning(s)\n`);
    process.exit(3);
  }
  process.stdout.write(`\n0 errors, ${warnings.length} warning(s)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
