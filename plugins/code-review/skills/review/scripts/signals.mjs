#!/usr/bin/env node
// signals — collect deterministic FACTS about a repo and its pending change.
//
// Emits raw signals only: extensions touched, manifests present, notable
// dependencies, diff shape, tool config presence, remote host. It never names
// a lens or persona — that judgment belongs to route-lenses.mjs. Zero
// dependencies; shells out to `git` only.
//
// Usage:
//   node signals.mjs [--root <dir>] [--base <ref>]

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { isMainModule } from "./lib/cli.mjs";

const MANIFEST_PATTERNS = [
  "package.json",
  "tsconfig*.json",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "pyproject.toml",
  "pom.xml",
  "build.gradle*",
  "nx.json",
  ".changeset",
  "api-extractor*.json",
  "pnpm-workspace.yaml",
];

const DEP_CHECKS = [
  { id: "spf13/cobra", file: "go.sum", pattern: /spf13\/cobra/ },
  { id: "yargs", file: "package.json", pattern: /"yargs"\s*:/ },
  { id: "commander", file: "package.json", pattern: /"commander"\s*:/ },
  { id: "clap", file: "Cargo.toml", pattern: /\bclap\b/ },
  { id: "sorbet", file: "Gemfile", pattern: /sorbet/i },
  { id: "@typescript-eslint/utils", file: "package.json", pattern: /"@typescript-eslint\/utils"\s*:/ },
  { id: "eslint", file: "package.json", pattern: /"eslint"\s*:/ },
];

/** Convert a single-level glob (`*` wildcard only) to a RegExp anchored to a whole name. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function isTestFile(file) {
  const base = path.basename(file);
  return (
    /(^|\/)(__tests__|test|tests|spec|specs)(\/|$)/i.test(file) ||
    /\.(test|spec)\.[^./]+$/i.test(base) ||
    /_test\.go$/i.test(base) ||
    /_spec\.rb$/i.test(base)
  );
}

function isDocFile(file) {
  const base = path.basename(file).toLowerCase();
  if (/^(readme|changelog|license|contributing)(\.[a-z0-9]+)?$/.test(base)) return true;
  if (/\.(md|mdx|txt|rst|adoc)$/i.test(file)) return true;
  if (/(^|\/)docs\//i.test(file)) return true;
  return false;
}

function isApiSurfaceFile(file) {
  const base = path.basename(file).toLowerCase();
  if (/\.proto$/i.test(file)) return true;
  if (/^(openapi|swagger)/i.test(base)) return true;
  if (/api-extractor.*\.json$/i.test(base)) return true;
  if (/(^|\/)api-report\//i.test(file)) return true;
  return false;
}

/**
 * Run git, returning stdout with only trailing newlines stripped, or null if
 * the command fails. Deliberately does NOT use `.trim()`: `git status
 * --porcelain` output can have a meaningful leading space on its first line
 * (e.g. " D path" for an unstaged delete), and trimming the whole string
 * would corrupt that line's path by one character.
 */
function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(
      /\r?\n+$/,
      "",
    );
  } catch {
    return null;
  }
}

function resolveBaseRef(root, explicitBase) {
  if (explicitBase) return explicitBase;

  const symbolic = git(root, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  let candidate = null;
  if (symbolic) {
    // refs/remotes/origin/HEAD -> origin/main
    const m = symbolic.match(/^refs\/remotes\/(.+)$/);
    if (m) candidate = m[1];
  }
  if (!candidate) {
    const shown = git(root, ["remote", "show", "origin"]);
    if (shown) {
      const m = shown.match(/HEAD branch:\s*(\S+)/);
      if (m) candidate = `origin/${m[1]}`;
    }
  }
  if (candidate) {
    const mergeBase = git(root, ["merge-base", "HEAD", candidate]);
    if (mergeBase) return mergeBase;
  }
  return null;
}

function parseNameStatus(output) {
  if (!output) return [];
  const rows = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0];
    // Renames: "R100\told\tnew" — the new path is what matters going forward.
    const file = status.startsWith("R") || status.startsWith("C") ? parts[2] : parts[1];
    if (file) rows.push({ status, file });
  }
  return rows;
}

function parsePorcelainStatus(output) {
  if (!output) return [];
  const rows = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    // Porcelain v1: "XY path" or "XY orig -> new" for renames.
    const status = line.slice(0, 2);
    let rest = line.slice(3);
    if (rest.includes(" -> ")) rest = rest.split(" -> ")[1];
    rows.push({ status: status.trim() || "M", file: rest });
  }
  return rows;
}

function parseShortstat(output) {
  if (!output) return { insertions: 0, deletions: 0 };
  const ins = output.match(/(\d+) insertion/);
  const del = output.match(/(\d+) deletion/);
  return {
    insertions: ins ? parseInt(ins[1], 10) : 0,
    deletions: del ? parseInt(del[1], 10) : 0,
  };
}

function collectChangedFiles(root, base) {
  const entries = new Map(); // file -> status (last write wins)

  if (base) {
    for (const { status, file } of parseNameStatus(git(root, ["diff", "--name-status", `${base}...HEAD`]))) {
      entries.set(file, status);
    }
  }
  // --untracked-files=all: list every file inside a new directory individually,
  // instead of collapsing it to a single "?? dir/" entry.
  for (const { status, file } of parsePorcelainStatus(
    git(root, ["status", "--porcelain", "--untracked-files=all"]),
  )) {
    entries.set(file, status);
  }

  const files = [...entries.keys()].sort();
  const newFiles = files.filter((f) => (entries.get(f) ?? "").startsWith("A")).length;
  const renames = files.filter((f) => (entries.get(f) ?? "").startsWith("R")).length;
  return { files, newFiles, renames };
}

function collectDiffLines(root, base) {
  let insertions = 0;
  let deletions = 0;
  if (base) {
    const s = parseShortstat(git(root, ["diff", "--shortstat", `${base}...HEAD`]));
    insertions += s.insertions;
    deletions += s.deletions;
  }
  const unstaged = parseShortstat(git(root, ["diff", "--shortstat"]));
  const staged = parseShortstat(git(root, ["diff", "--cached", "--shortstat"]));
  insertions += unstaged.insertions + staged.insertions;
  deletions += unstaged.deletions + staged.deletions;
  return insertions + deletions;
}

function collectManifests(root) {
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const found = [];
  for (const pattern of MANIFEST_PATTERNS) {
    if (pattern.includes("*")) {
      const re = globToRegExp(pattern);
      const match = names.find((n) => re.test(n));
      if (match) found.push(match);
    } else if (names.includes(pattern)) {
      found.push(pattern);
    }
  }
  return found;
}

function readRootFile(root, name) {
  try {
    return fs.readFileSync(path.join(root, name), "utf8");
  } catch {
    return null;
  }
}

function collectDeps(root) {
  const found = [];
  const cache = new Map();
  for (const check of DEP_CHECKS) {
    if (!cache.has(check.file)) cache.set(check.file, readRootFile(root, check.file));
    const content = cache.get(check.file);
    if (content && check.pattern.test(content)) found.push(check.id);
  }
  return found;
}

function collectBins(root) {
  const content = readRootFile(root, "package.json");
  if (!content) return false;
  try {
    const pkg = JSON.parse(content);
    return pkg.bin !== undefined && pkg.bin !== null;
  } catch {
    return false;
  }
}

function collectTools(root, manifests) {
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    names = [];
  }
  const has = (pattern) => names.some((n) => globToRegExp(pattern).test(n));

  let linter = null;
  if (has(".eslintrc*") || has("eslint.config.*")) linter = "eslint";
  else if (has(".golangci.y*ml")) linter = "golangci-lint";
  else if (has(".rubocop.yml")) linter = "rubocop";
  else if (has(".ruff.toml") || has(".pylintrc")) linter = "ruff";

  let formatter = null;
  if (has(".prettierrc*") || has("prettier.config.*")) formatter = "prettier";
  else if (manifests.includes("go.mod")) formatter = "gofmt";
  else if (manifests.includes("Cargo.toml")) formatter = "rustfmt";

  let testFramework = null;
  if (has("vitest.config.*")) testFramework = "vitest";
  else if (has("jest.config.*")) testFramework = "jest";
  else if (manifests.includes("go.mod")) testFramework = "go test";
  else if (manifests.includes("Cargo.toml")) testFramework = "cargo test";
  else if (manifests.includes("Gemfile")) testFramework = "rspec";
  else if (manifests.includes("pyproject.toml")) testFramework = "pytest";

  return { linter, formatter, test_framework: testFramework };
}

function collectRemoteHost(root) {
  const url = git(root, ["remote", "get-url", "origin"]);
  if (!url) return null;
  // scp-like: git@host:path — or a URL: https://host/path
  const scpMatch = url.match(/^[^@]+@([^:/]+)[:/]/);
  if (scpMatch) return scpMatch[1];
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Collect deterministic facts about a repo and its pending change.
 * @param {{root?: string, base?: string}} [options]
 */
export function collectSignals({ root = process.cwd(), base } = {}) {
  const resolvedBase = resolveBaseRef(root, base);
  const { files, newFiles, renames } = collectChangedFiles(root, resolvedBase);

  const byExt = {};
  const dirSet = new Set();
  for (const file of files) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (ext) byExt[ext] = (byExt[ext] ?? 0) + 1;
    const slash = file.indexOf("/");
    if (slash > 0) dirSet.add(file.slice(0, slash));
  }

  const manifests = collectManifests(root);
  const testsTouched = files.some(isTestFile);
  const sourceTouched = files.some((f) => !isTestFile(f) && !isDocFile(f));
  const docsOnly = files.length > 0 && files.every(isDocFile);
  const apiSurface = files.some(isApiSurfaceFile);

  return {
    changed: {
      files,
      by_ext: byExt,
      dirs: [...dirSet].sort(),
    },
    manifests,
    deps: collectDeps(root),
    bins: collectBins(root),
    diff: {
      lines: collectDiffLines(root, resolvedBase),
      files: files.length,
      new_files: newFiles,
      renames,
      api_surface: apiSurface,
      tests_touched: testsTouched,
      source_touched: sourceTouched,
      docs_only: docsOnly,
    },
    tools: collectTools(root, manifests),
    remote_host: collectRemoteHost(root),
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = argv[++i];
    else if (a === "--base") args.base = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const signals = collectSignals({ root: args.root ? path.resolve(args.root) : process.cwd(), base: args.base });
  process.stdout.write(`${JSON.stringify(signals, null, 2)}\n`);
}

if (isMainModule(import.meta.url)) {
  main();
}
