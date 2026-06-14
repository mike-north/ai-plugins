/**
 * Deterministic bookkeeping engine for Claude Code customization manifests.
 *
 * Owns reading/writing per-customization manifest JSON files in scope directories.
 * No LLM reasoning; pure, testable logic using node: builtins only.
 *
 * CLI usage:
 *   node manifest.mjs add --file <path>          # or via stdin
 *   node manifest.mjs list [--scope ...] [--status ...] [--type ...] [--json]
 *   node manifest.mjs get <slug> [--scope ...]
 *   node manifest.mjs remove <slug> [--scope ...]
 *   node manifest.mjs config get [key]
 *   node manifest.mjs config set <key> <value>
 *
 * Environment overrides:
 *   CUSTOMIZATIONS_HOME         - replaces ~/.claude/customizations
 *   CUSTOMIZATIONS_PROJECT_DIR  - replaces ${PWD}/.claude/customizations
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {"script"|"memory"|"rule"|"hook"|"skill"|"agent"|"mcp"|"monitor"|"plugin"|"marketplace"|"unknown"} CustomizationType
 * @typedef {"user"|"project"} CustomizationScope
 * @typedef {"proposed"|"active"} CustomizationStatus
 */

/**
 * @typedef {Object} ManifestComponent
 * @property {string} path
 * @property {"created"|"modified"} action
 * @property {string} description
 */

/**
 * @typedef {Object} ManifestEntry
 * @property {string} slug
 * @property {string} type
 * @property {string} description
 * @property {string} scope
 * @property {string} assistant
 * @property {string} status
 * @property {string} created
 * @property {ManifestComponent[]} components
 */

/**
 * @typedef {Object} ListEntry
 * @property {string} slug
 * @property {string} type
 * @property {string} description
 * @property {string} scope
 * @property {string} assistant
 * @property {string} status
 * @property {string} created
 * @property {ManifestComponent[]} components
 * @property {"user"|"project"} resolvedScope
 * @property {string} path
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const REQUIRED_FIELDS = ["slug", "type", "description", "scope", "components"];
const VALID_TYPES = new Set([
  "script",
  "memory",
  "rule",
  "hook",
  "skill",
  "agent",
  "mcp",
  "monitor",
  "plugin",
  "marketplace",
]);
const VALID_SCOPES = new Set(["user", "project"]);
const VALID_STATUSES = new Set(["proposed", "active"]);

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path for the user-scope customizations directory.
 * Honors the CUSTOMIZATIONS_HOME env override.
 *
 * @returns {string}
 */
export function resolveUserDir() {
  const override = process.env["CUSTOMIZATIONS_HOME"];
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".claude", "customizations");
}

/**
 * Returns the absolute path for the project-scope customizations directory.
 * Honors the CUSTOMIZATIONS_PROJECT_DIR env override.
 *
 * @returns {string}
 */
export function resolveProjectDir() {
  const override = process.env["CUSTOMIZATIONS_PROJECT_DIR"];
  if (override) return path.resolve(override);
  return path.join(process.cwd(), ".claude", "customizations");
}

/**
 * Resolves a scope name to its directory.
 *
 * @param {"user"|"project"} scope
 * @returns {string}
 */
export function resolveScopeDir(scope) {
  if (scope === "user") return resolveUserDir();
  if (scope === "project") return resolveProjectDir();
  throw new Error(`Unknown scope: "${scope}". Must be "user" or "project".`);
}

// ---------------------------------------------------------------------------
// Manifest I/O helpers
// ---------------------------------------------------------------------------

/**
 * Reads and parses a single manifest JSON file. Applies backward-compat defaults
 * for missing `type` (→ "unknown") and `status` (→ "active"). Returns null if
 * the file cannot be read or parsed.
 *
 * @param {string} filePath
 * @returns {ManifestEntry|null}
 */
function readManifestFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // Apply backward-compat defaults
  if (parsed.type === undefined) parsed.type = "unknown";
  if (parsed.status === undefined) parsed.status = "active";
  return parsed;
}

/**
 * Lists all manifest entry files in a given directory, excluding config.json.
 * Returns an array of { entry, filePath, scope } objects.
 *
 * @param {string} dir
 * @param {"user"|"project"} scope
 * @returns {Array<{entry: ManifestEntry, filePath: string, scope: "user"|"project"}>}
 */
function listDir(dir, scope) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const results = [];
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    if (name === "config.json") continue; // not a customization entry
    const filePath = path.join(dir, name);
    const entry = readManifestFile(filePath);
    if (entry !== null) {
      results.push({ entry, filePath, scope });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Writes a new manifest entry to the appropriate scope directory.
 * Validates required fields, slug format, type, scope.
 * Refuses to overwrite unless force=true.
 *
 * @param {Record<string, unknown>} data - The raw entry object (e.g. from JSON)
 * @param {{force?: boolean, now?: string}} [opts]
 * @returns {{writtenPath: string, entry: ManifestEntry}}
 */
export function addEntry(data, opts = {}) {
  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    if (data[field] === undefined || data[field] === null) {
      const err = new Error(`Missing required field: "${field}"`);
      err.code = "VALIDATION_ERROR";
      throw err;
    }
  }

  const slug = String(data.slug);
  if (!SLUG_RE.test(slug)) {
    const err = new Error(
      `Invalid slug "${slug}": must match ^[a-z][a-z0-9-]*$ (lowercase, start with letter, hyphens ok)`,
    );
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const scopeRaw = String(data.scope);
  if (!VALID_SCOPES.has(scopeRaw)) {
    const err = new Error(`Invalid scope "${scopeRaw}": must be "user" or "project"`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  // Apply defaults
  const entry = {
    slug,
    type: data.type !== undefined ? String(data.type) : "unknown",
    description: String(data.description),
    scope: scopeRaw,
    assistant: data.assistant !== undefined ? String(data.assistant) : "claude",
    status: data.status !== undefined ? String(data.status) : "active",
    created:
      data.created !== undefined
        ? String(data.created)
        : opts.now ?? new Date().toISOString(),
    components: Array.isArray(data.components) ? data.components : [],
  };

  const scopeDir = resolveScopeDir(scopeRaw);
  fs.mkdirSync(scopeDir, { recursive: true });

  const filePath = path.join(scopeDir, `${slug}.json`);

  if (!opts.force && fs.existsSync(filePath)) {
    const err = new Error(
      `Entry "${slug}" already exists at ${filePath}. Use --force to overwrite.`,
    );
    err.code = "ALREADY_EXISTS";
    throw err;
  }

  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2) + "\n", "utf8");
  return { writtenPath: filePath, entry };
}

/**
 * Lists manifest entries from one or both scope directories with optional filters.
 *
 * @param {{scope?: "user"|"project"|"all", status?: string, type?: string}} [filters]
 * @returns {ListEntry[]}
 */
export function listEntries(filters = {}) {
  const scopeFilter = filters.scope ?? "all";
  const statusFilter = filters.status ?? "all";
  const typeFilter = filters.type ?? undefined;

  /** @type {Array<{entry: ManifestEntry, filePath: string, scope: "user"|"project"}>} */
  let items = [];

  if (scopeFilter === "user" || scopeFilter === "all") {
    items = items.concat(listDir(resolveUserDir(), "user"));
  }
  if (scopeFilter === "project" || scopeFilter === "all") {
    items = items.concat(listDir(resolveProjectDir(), "project"));
  }

  // Apply filters
  if (statusFilter !== "all") {
    items = items.filter((i) => i.entry.status === statusFilter);
  }
  if (typeFilter !== undefined) {
    items = items.filter((i) => i.entry.type === typeFilter);
  }

  // Sort deterministically: scope (user first), then slug
  items.sort((a, b) => {
    if (a.scope !== b.scope) {
      return a.scope === "user" ? -1 : 1;
    }
    return a.entry.slug.localeCompare(b.entry.slug);
  });

  return items.map(({ entry, filePath, scope }) => ({
    ...entry,
    resolvedScope: scope,
    path: filePath,
  }));
}

/**
 * Retrieves a single manifest entry by slug.
 *
 * @param {string} slug
 * @param {{scope?: "user"|"project"|"all"}} [opts]
 * @returns {ListEntry}
 * @throws {Error} with code NOT_FOUND if not found
 */
export function getEntry(slug, opts = {}) {
  const scopeFilter = opts.scope ?? "all";
  const entries = listEntries({ scope: scopeFilter });
  const found = entries.find((e) => e.slug === slug);
  if (!found) {
    const err = new Error(
      `Customization "${slug}" not found${scopeFilter !== "all" ? ` in scope "${scopeFilter}"` : ""}.`,
    );
    err.code = "NOT_FOUND";
    throw err;
  }
  return found;
}

/**
 * Removes a manifest entry by slug. Returns the removed entry (including components).
 * Does NOT touch the artifact files listed in components.
 *
 * @param {string} slug
 * @param {{scope?: "user"|"project"|"all"}} [opts]
 * @returns {ListEntry}
 * @throws {Error} with code NOT_FOUND if not found
 */
export function removeEntry(slug, opts = {}) {
  const entry = getEntry(slug, opts);
  fs.unlinkSync(entry.path);
  return entry;
}

// ---------------------------------------------------------------------------
// Config I/O
// ---------------------------------------------------------------------------

/**
 * Returns the path to the user-scope config.json.
 *
 * @returns {string}
 */
function configFilePath() {
  return path.join(resolveUserDir(), "config.json");
}

/**
 * Reads the config.json from the user scope directory.
 * Returns an empty object if the file does not exist.
 *
 * @returns {Record<string, unknown>}
 */
export function readConfig() {
  const filePath = configFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Writes a value at a dotted key path into config.json.
 * Creates the file and parent directories if needed.
 *
 * @param {string} key - Dotted key path, e.g. "personalMarketplace.path"
 * @param {unknown} value
 * @returns {Record<string, unknown>} The updated config object
 */
export function writeConfig(key, value) {
  const config = readConfig();
  const parts = key.split(".");

  // Navigate/create nested objects for all but the last key
  let obj = config;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      obj[part] === null ||
      typeof obj[part] !== "object" ||
      Array.isArray(obj[part])
    ) {
      obj[part] = {};
    }
    obj = /** @type {Record<string, unknown>} */ (obj[part]);
  }
  obj[/** @type {string} */ (parts[parts.length - 1])] = value;

  const filePath = configFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return config;
}

/**
 * Gets a value from config by optional dotted key path.
 * If key is undefined/null/empty, returns the whole config object.
 *
 * @param {string|undefined} key
 * @returns {unknown}
 */
export function getConfigValue(key) {
  const config = readConfig();
  if (!key) return config;
  const parts = key.split(".");
  let obj = /** @type {unknown} */ (config);
  for (const part of parts) {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      return undefined;
    }
    obj = /** @type {Record<string, unknown>} */ (obj)[part];
  }
  return obj;
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

/**
 * Renders a compact aligned table of entries to stdout.
 *
 * @param {ListEntry[]} entries
 */
function printTable(entries) {
  if (entries.length === 0) {
    process.stdout.write("(no customizations found)\n");
    return;
  }

  const COL_WIDTHS = {
    slug: Math.max(4, ...entries.map((e) => e.slug.length)),
    type: Math.max(4, ...entries.map((e) => e.type.length)),
    scope: Math.max(5, ...entries.map((e) => e.resolvedScope.length)),
    status: Math.max(6, ...entries.map((e) => e.status.length)),
  };

  function pad(s, n) {
    return s.padEnd(n);
  }

  const header = [
    pad("SLUG", COL_WIDTHS.slug),
    pad("TYPE", COL_WIDTHS.type),
    pad("SCOPE", COL_WIDTHS.scope),
    pad("STATUS", COL_WIDTHS.status),
    "DESCRIPTION",
  ].join("  ");

  const sep = "-".repeat(header.length);

  process.stdout.write(header + "\n");
  process.stdout.write(sep + "\n");
  for (const e of entries) {
    const row = [
      pad(e.slug, COL_WIDTHS.slug),
      pad(e.type, COL_WIDTHS.type),
      pad(e.resolvedScope, COL_WIDTHS.scope),
      pad(e.status, COL_WIDTHS.status),
      e.description,
    ].join("  ");
    process.stdout.write(row + "\n");
  }
}

/**
 * Reads all stdin into a string.
 *
 * @returns {Promise<string>}
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/**
 * Prints a usage message to stderr and exits with code 2.
 *
 * @param {string} [extra]
 */
function usageError(extra) {
  const msg = [
    "Usage:",
    "  node manifest.mjs add --file <path>                     # or pipe JSON to stdin",
    "  node manifest.mjs add [--force]                         # read from stdin",
    "  node manifest.mjs list [--scope user|project|all] [--status active|proposed|all] [--type <t>] [--json]",
    "  node manifest.mjs get <slug> [--scope user|project|all]",
    "  node manifest.mjs remove <slug> [--scope user|project|all]",
    "  node manifest.mjs config get [<dotted.key>]",
    "  node manifest.mjs config set <dotted.key> <value>",
    "",
    "Environment:",
    "  CUSTOMIZATIONS_HOME         - override ~/.claude/customizations",
    "  CUSTOMIZATIONS_PROJECT_DIR  - override ${PWD}/.claude/customizations",
  ].join("\n");
  process.stderr.write((extra ? `Error: ${extra}\n\n` : "") + msg + "\n");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

/**
 * Main CLI entry point. Parses argv and dispatches to the appropriate function.
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {Promise<void>}
 */
export async function main(argv) {
  const [subcommand, ...rest] = argv;

  if (!subcommand) {
    usageError("No subcommand provided");
  }

  // -------------------------------------------------------------------------
  // add
  // -------------------------------------------------------------------------
  if (subcommand === "add") {
    let filePath;
    let force = false;

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--file") {
        filePath = rest[i + 1];
        i++;
      } else if (rest[i] === "--force") {
        force = true;
      } else {
        usageError(`Unknown option for "add": ${rest[i]}`);
      }
    }

    let raw;
    if (filePath) {
      try {
        raw = fs.readFileSync(filePath, "utf8");
      } catch (err) {
        process.stderr.write(`Error reading file "${filePath}": ${err.message}\n`);
        process.exit(1);
      }
    } else {
      raw = await readStdin();
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(`Error: invalid JSON: ${err.message}\n`);
      process.exit(1);
    }

    try {
      const { writtenPath } = addEntry(data, { force });
      process.stdout.write(`Written: ${writtenPath}\n`);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(err.code === "VALIDATION_ERROR" || err.code === "ALREADY_EXISTS" ? 1 : 1);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  if (subcommand === "list") {
    let scopeFilter = "all";
    let statusFilter = "all";
    let typeFilter;
    let jsonOutput = false;

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--scope") {
        scopeFilter = rest[i + 1];
        i++;
        if (!["user", "project", "all"].includes(scopeFilter)) {
          usageError(`Invalid --scope "${scopeFilter}". Must be user|project|all`);
        }
      } else if (rest[i] === "--status") {
        statusFilter = rest[i + 1];
        i++;
        if (!["active", "proposed", "all"].includes(statusFilter)) {
          usageError(`Invalid --status "${statusFilter}". Must be active|proposed|all`);
        }
      } else if (rest[i] === "--type") {
        typeFilter = rest[i + 1];
        i++;
      } else if (rest[i] === "--json") {
        jsonOutput = true;
      } else {
        usageError(`Unknown option for "list": ${rest[i]}`);
      }
    }

    const entries = listEntries({
      scope: scopeFilter,
      status: statusFilter,
      type: typeFilter,
    });

    if (jsonOutput) {
      process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    } else {
      printTable(entries);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------
  if (subcommand === "get") {
    const slug = rest[0];
    if (!slug || slug.startsWith("--")) {
      usageError('"get" requires a <slug> argument');
    }

    let scopeFilter = "all";
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--scope") {
        scopeFilter = rest[i + 1];
        i++;
        if (!["user", "project", "all"].includes(scopeFilter)) {
          usageError(`Invalid --scope "${scopeFilter}". Must be user|project|all`);
        }
      } else {
        usageError(`Unknown option for "get": ${rest[i]}`);
      }
    }

    try {
      const entry = getEntry(slug, { scope: scopeFilter });
      process.stdout.write(JSON.stringify(entry, null, 2) + "\n");
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------
  if (subcommand === "remove") {
    const slug = rest[0];
    if (!slug || slug.startsWith("--")) {
      usageError('"remove" requires a <slug> argument');
    }

    let scopeFilter = "all";
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--scope") {
        scopeFilter = rest[i + 1];
        i++;
        if (!["user", "project", "all"].includes(scopeFilter)) {
          usageError(`Invalid --scope "${scopeFilter}". Must be user|project|all`);
        }
      } else {
        usageError(`Unknown option for "remove": ${rest[i]}`);
      }
    }

    try {
      const removed = removeEntry(slug, { scope: scopeFilter });
      process.stdout.write(JSON.stringify(removed.components, null, 2) + "\n");
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // config
  // -------------------------------------------------------------------------
  if (subcommand === "config") {
    const [configSub, ...configRest] = rest;

    if (configSub === "get") {
      const key = configRest[0]; // optional
      const value = getConfigValue(key);
      process.stdout.write(JSON.stringify(value, null, 2) + "\n");
      return;
    }

    if (configSub === "set") {
      const key = configRest[0];
      const rawValue = configRest[1];
      if (!key) usageError('"config set" requires a <key>');
      if (rawValue === undefined) usageError('"config set" requires a <value>');

      // Attempt to parse as JSON; fall back to treating as string
      let value;
      try {
        value = JSON.parse(rawValue);
      } catch {
        value = rawValue;
      }

      writeConfig(key, value);
      process.stdout.write(`config.${key} set\n`);
      return;
    }

    usageError(`Unknown "config" subcommand "${configSub ?? ""}". Use "get" or "set".`);
    return;
  }

  // -------------------------------------------------------------------------
  // Unknown subcommand
  // -------------------------------------------------------------------------
  usageError(`Unknown subcommand "${subcommand}"`);
}

// ---------------------------------------------------------------------------
// CLI guard — only execute when run directly
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  });
}
