/**
 * Registry types and readers for the toolsmith CLI.
 *
 * Schema reference:
 * plugins/toolsmith/skills/toolsmith/references/registry-schema.md
 */
import { readFileSync } from "node:fs";

export interface StagedDraft {
  path: string;
  sha256?: string;
  note?: string;
  since?: string;
}

export interface ToolEntry {
  name?: string;
  path?: string;
  purpose?: string;
  args?: string;
  scope?: string;
  covers?: string[];
  status?: string;
  approvedSha256?: string;
  permissionRule?: string;
  staged?: StagedDraft;
  [key: string]: unknown;
}

export interface Registry {
  version?: number;
  tools: ToolEntry[];
  [key: string]: unknown;
}

export function readJsonOrNull(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a registry file leniently: returns the parsed registry when it has the
 * expected shape, or null when the file is missing/unparseable/wrong-shaped.
 * Callers decide whether null is a hard error (approve/verify: fail closed)
 * or a reportable condition (list: surface a parse error for the scope).
 */
export function readRegistry(path: string): Registry | null {
  const parsed = readJsonOrNull(path);
  if (!isPlainObject(parsed) || !Array.isArray(parsed["tools"])) return null;
  return parsed as unknown as Registry;
}
