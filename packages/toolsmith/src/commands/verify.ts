/**
 * `toolsmith verify` — read-only integrity check of LIVE pins (contract §2's
 * producer side): one line per registry tool, prefixed OK / DRIFTED / MISSING
 * / draft. Exit 0 when everything checks out, 1 when anything drifted or is
 * missing. Ported from `toolsmith-approve.mjs --verify`, byte-compatible
 * output so callers (and the /toolsmith:list wrapper) keep working.
 */
import { existsSync } from "node:fs";
import { sha256OfFile } from "../lib/fsutil.js";
import { readRegistry, type ToolEntry } from "../lib/registry.js";
import { resolveScope, type Scope } from "../lib/scope.js";

export type VerifyStatus = "OK" | "DRIFTED" | "MISSING" | "draft";

export interface VerifyLine {
  status: VerifyStatus;
  name: string;
  path: string;
}

/** Compute one tool's live-pin verification status. Never throws. */
export function verifyTool(tool: ToolEntry | null | undefined, scope: Scope): VerifyLine {
  const name = tool?.name ?? "(unnamed)";
  const rawToolPath = tool?.path ?? "(no path)";
  if (tool?.status !== "approved") {
    return { status: "draft", name, path: rawToolPath };
  }
  // A registry entry's `path` is untrusted input (the registry could be
  // tampered, or hand-edited incorrectly): re-validate it with the same
  // strict path validation used on the write side before ever resolving it
  // to a script file. An invalid path is never touched on disk — it is
  // reported as MISSING and fails the run.
  const path = scope.normalize(rawToolPath);
  if (!path) {
    return { status: "MISSING", name, path: rawToolPath };
  }
  const abs = scope.scriptAbs(path);
  if (!existsSync(abs)) {
    return { status: "MISSING", name, path };
  }
  let sha: string;
  try {
    sha = sha256OfFile(abs);
  } catch {
    return { status: "MISSING", name, path };
  }
  return sha === tool.approvedSha256 ? { status: "OK", name, path } : { status: "DRIFTED", name, path };
}

const STATUS_PAD: Record<VerifyStatus, string> = {
  OK: "OK       ",
  DRIFTED: "DRIFTED  ",
  MISSING: "MISSING  ",
  draft: "draft    ",
};

export interface VerifyOptions {
  rawPath?: string | undefined;
  userScope: boolean;
}

export function runVerify({ rawPath, userScope }: VerifyOptions): number {
  const resolution = resolveScope(userScope);
  if (!resolution.ok) {
    process.stderr.write(resolution.error);
    return 1;
  }
  const scope = resolution.scope;

  const regPath = scope.regPath;
  if (!existsSync(regPath)) {
    process.stderr.write(`Error: no registry found at ${regPath}.\n`);
    return 1;
  }
  const registry = readRegistry(regPath);
  if (!registry) {
    process.stderr.write(`Error: ${regPath} is not a valid registry (malformed JSON or missing "tools" array).\n`);
    return 1;
  }

  let filterPath: string | null = null;
  if (rawPath) {
    filterPath = scope.normalize(rawPath);
    if (!filterPath) {
      process.stderr.write(`Error: invalid path "${rawPath}".\n`);
      return 1;
    }
  }

  const tools = filterPath ? registry.tools.filter((t) => t && t.path === filterPath) : registry.tools;
  if (filterPath && tools.length === 0) {
    process.stderr.write(`Error: no registry entry found with path "${filterPath}".\n`);
    return 1;
  }

  let anyBad = false;
  for (const tool of tools) {
    const line = verifyTool(tool, scope);
    if (line.status === "DRIFTED" || line.status === "MISSING") anyBad = true;
    process.stdout.write(`${STATUS_PAD[line.status]}${line.name}\t${line.path}\n`);
  }

  return anyBad ? 1 : 0;
}
