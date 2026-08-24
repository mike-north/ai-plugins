#!/usr/bin/env node

// src/commands/approve.ts
import { chmodSync, existsSync as existsSync3, readFileSync as readFileSync4, statSync, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";

// src/lib/fsutil.ts
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync as readFileSync2,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

// src/lib/registry.ts
import { readFileSync } from "node:fs";
function readJsonOrNull(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readRegistry(path) {
  const parsed = readJsonOrNull(path);
  if (!isPlainObject(parsed) || !Array.isArray(parsed["tools"])) return null;
  return parsed;
}

// src/lib/fsutil.ts
function sha256OfBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function sha256OfFile(absPath) {
  return sha256OfBytes(readFileSync2(absPath));
}
function atomicWrite(path, content) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmpDir = mkdtempSync(join(dir, ".toolsmith-approve-"));
  const tmpFile = join(tmpDir, "tmp");
  try {
    if (Buffer.isBuffer(content)) writeFileSync(tmpFile, content);
    else writeFileSync(tmpFile, content, "utf8");
    renameSync(tmpFile, path);
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
    }
  }
}
function toJsonFile(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}
function readSettingsStrict(path) {
  if (!existsSync(path)) return { ok: true, value: {} };
  let raw;
  try {
    raw = readFileSync2(path, "utf8");
  } catch (err) {
    return { ok: false, reason: `could not read ${path}: ${err.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: `${path} exists but is not valid JSON; refusing to overwrite it \u2014 fix the JSON and re-run.`
    };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      reason: `${path} exists but its top level is not a JSON object; refusing to overwrite it \u2014 fix the JSON and re-run.`
    };
  }
  if ("permissions" in parsed && !isPlainObject(parsed["permissions"])) {
    return {
      ok: false,
      reason: `${path} has a "permissions" field that is not a JSON object; refusing to overwrite it \u2014 fix the JSON and re-run.`
    };
  }
  const permissions = parsed["permissions"];
  if (isPlainObject(permissions) && "allow" in permissions && !Array.isArray(permissions["allow"])) {
    return {
      ok: false,
      reason: `${path} has a "permissions.allow" field that is not a JSON array; refusing to overwrite it \u2014 fix the JSON and re-run.`
    };
  }
  return { ok: true, value: parsed };
}
var _chflagsAvailable;
function chflagsAvailable() {
  if (_chflagsAvailable === void 0) {
    try {
      const r = spawnSync("which", ["chflags"], { stdio: "ignore" });
      _chflagsAvailable = r.status === 0;
    } catch {
      _chflagsAvailable = false;
    }
  }
  return _chflagsAvailable;
}
function tryChflags(flag, absPath) {
  if (!chflagsAvailable()) {
    return { ok: false, reason: "chflags is not available on this platform (non-macOS/BSD)" };
  }
  try {
    const r = spawnSync("chflags", [flag, absPath], { stdio: "pipe" });
    if (r.status !== 0) {
      const stderr = r.stderr ? r.stderr.toString().trim() : "";
      return { ok: false, reason: stderr || `chflags ${flag} exited with status ${r.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// src/lib/diff.ts
function unifiedLineDiff(oldText, newText) {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i2 = n - 1; i2 >= 0; i2--) {
    const row = lcs[i2];
    const next = lcs[i2 + 1];
    for (let j2 = m - 1; j2 >= 0; j2--) {
      row[j2] = a[i2] === b[j2] ? next[j2 + 1] + 1 : Math.max(next[j2], row[j2 + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < n) {
    lines.push(`- ${a[i]}`);
    i++;
  }
  while (j < m) {
    lines.push(`+ ${b[j]}`);
    j++;
  }
  return lines.join("\n");
}

// src/lib/scope.ts
import { realpathSync } from "node:fs";
import { join as join2, resolve } from "node:path";
import { homedir } from "node:os";
var SAFE_PATH_CHARS = /^[A-Za-z0-9._/-]+$/;
function normalizePath(rawPath) {
  if (typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  if (trimmed.includes("\\")) return null;
  if (trimmed.startsWith("/")) return null;
  if (/^[A-Za-z]:/.test(trimmed)) return null;
  const stripped = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
  if (!stripped || stripped.startsWith("/")) return null;
  if (!SAFE_PATH_CHARS.test(stripped)) return null;
  const segments = stripped.split("/");
  if (segments.some((seg) => seg === ".." || seg === "." || seg === "")) return null;
  return stripped;
}
function normalizeUserScopedPath(rawPath, prefix) {
  if (typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const candidate = trimmed.startsWith(`${prefix}/`) ? trimmed : `${prefix}/${trimmed}`;
  const normalized = normalizePath(candidate);
  if (!normalized) return null;
  const segments = normalized.split("/");
  if (segments[0] !== prefix || segments.length < 2 || !segments[1]) return null;
  return normalized;
}
function normalizeUserPath(rawPath) {
  return normalizeUserScopedPath(rawPath, "tools");
}
function normalizeUserStagedPath(rawPath) {
  return normalizeUserScopedPath(rawPath, "staging");
}
function normalizeStagedProjectPath(rawPath) {
  const normalized = normalizePath(rawPath);
  if (!normalized) return null;
  const segments = normalized.split("/");
  if (segments.length < 4 || !segments[3]) return null;
  if (segments[0] !== ".claude" || segments[1] !== "toolsmith" || segments[2] !== "staging") return null;
  return normalized;
}
function projectRoot() {
  return process.env["CLAUDE_PROJECT_DIR"] || process.env["CURSOR_PROJECT_DIR"] || process.cwd();
}
function resolveHome() {
  try {
    const home = homedir();
    return typeof home === "string" && home ? home : null;
  } catch {
    return null;
  }
}
function sameFile(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}
function registryPathFor(root) {
  return join2(root, ".claude", "toolsmith", "registry.json");
}
function settingsPathFor(root) {
  return join2(root, ".claude", "settings.json");
}
function userRegistryPath(home) {
  return join2(home, ".claude", "toolsmith", "registry.json");
}
function userSettingsPath(home) {
  return join2(home, ".claude", "settings.json");
}
function resolveScope(userScope) {
  if (!userScope) {
    const root = projectRoot();
    const regPath = registryPathFor(root);
    const home2 = resolveHome();
    if (home2 && sameFile(regPath, userRegistryPath(home2))) {
      return {
        ok: false,
        error: `Error: this session's project root is the home directory, so the "project" registry (${regPath}) is actually the user-scope registry. Re-run with --user so paths resolve against ~/.claude/toolsmith/ correctly.
`
      };
    }
    return {
      ok: true,
      scope: {
        kind: "project",
        normalize: normalizePath,
        normalizeStaged: normalizeStagedProjectPath,
        regPath,
        settingsFile: settingsPathFor(root),
        scriptAbs: (path) => join2(root, path),
        stagedAbs: (stagedPath) => join2(root, stagedPath),
        ruleFor: (path) => `Bash(${path}:*)`,
        displayPath: (path) => path,
        invalidPathMessage: (rawPath) => `Error: invalid path "${rawPath}". Paths must be project-relative, contain no ".." segments, and use forward slashes only. Nothing written.
`,
        invalidStagedPathMessage: (rawPath) => `Error: invalid staged.path "${rawPath}" in the registry entry. It must be project-relative, under ".claude/toolsmith/staging/", with no ".." segments. Nothing written.
`
      }
    };
  }
  const home = resolveHome();
  if (!home) {
    return { ok: false, error: `Error: could not resolve the home directory for --user. Nothing written.
` };
  }
  return {
    ok: true,
    scope: {
      kind: "user",
      normalize: normalizeUserPath,
      normalizeStaged: normalizeUserStagedPath,
      regPath: userRegistryPath(home),
      settingsFile: userSettingsPath(home),
      scriptAbs: (path) => resolve(home, ".claude", "toolsmith", path),
      stagedAbs: (stagedPath) => resolve(home, ".claude", "toolsmith", stagedPath),
      ruleFor: (_path, scriptAbs) => `Bash(${scriptAbs}:*)`,
      displayPath: (_path, scriptAbs) => scriptAbs,
      invalidPathMessage: (rawPath) => `Error: invalid tool "${rawPath}". Expected a bare tool name or "tools/<name>", with no ".." segments, resolving under ~/.claude/toolsmith/tools/. Nothing written.
`,
      invalidStagedPathMessage: (rawPath) => `Error: invalid staged tool "${rawPath}" in the registry entry. Expected "staging/<name>", with no ".." segments, resolving under ~/.claude/toolsmith/staging/. Nothing written.
`
    }
  };
}

// src/commands/lint.ts
import { existsSync as existsSync2, readFileSync as readFileSync3 } from "node:fs";
import { spawnSync as spawnSync2 } from "node:child_process";
var PENDING_FORGE_RULES = [
  "contract-header-present",
  "require-declares-usage",
  "side-effect-honesty",
  "timeout-discipline",
  "exit-code-map-integrity",
  "runtime-pin-and-prelude",
  "docs-drift",
  "confirm-for-severe",
  "rationale-for-authority",
  "composition-declares-inputs",
  "no-inline-config"
];
var _bashAvailable;
function bashAvailable() {
  if (_bashAvailable === void 0) {
    try {
      _bashAvailable = spawnSync2("bash", ["-c", "true"], { stdio: "ignore" }).status === 0;
    } catch {
      _bashAvailable = false;
    }
  }
  return _bashAvailable;
}
var _shellcheckAvailable;
function shellcheckAvailable() {
  if (_shellcheckAvailable === void 0) {
    try {
      _shellcheckAvailable = spawnSync2("shellcheck", ["--version"], { stdio: "ignore" }).status === 0;
    } catch {
      _shellcheckAvailable = false;
    }
  }
  return _shellcheckAvailable;
}
function lintGate(bytes, displayPath) {
  const errors = [];
  const warnings = [];
  const skipped = [];
  const text = bytes.toString("utf8");
  if (bytes.length === 0) {
    errors.push({ rule: "non-empty", message: `${displayPath} is empty \u2014 there is nothing to review or promote.` });
    return { errors, warnings, pending: [...PENDING_FORGE_RULES], skipped };
  }
  if (bytes.includes(0)) {
    errors.push({
      rule: "text-script",
      message: `${displayPath} contains NUL bytes \u2014 forged tools are text shell scripts, not binaries.`
    });
    return { errors, warnings, pending: [...PENDING_FORGE_RULES], skipped };
  }
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith("#!")) {
    warnings.push({
      rule: "shebang",
      message: `missing shebang \u2014 forged tools should start with "#!/bin/bash" (or "#!/usr/bin/env bash").`
    });
  } else if (!/\b(bash|sh)\b/.test(firstLine)) {
    warnings.push({
      rule: "shebang",
      message: `shebang "${firstLine}" is not a bash/sh interpreter \u2014 forged tools are shell scripts.`
    });
  }
  if (bashAvailable()) {
    const r = spawnSync2("bash", ["-n"], { input: bytes, stdio: ["pipe", "ignore", "pipe"] });
    if (r.status !== 0) {
      const stderr = r.stderr ? r.stderr.toString().trim().replace(/^bash: line /gm, "line ") : "";
      errors.push({
        rule: "bash-syntax",
        message: `bash -n rejected the script${stderr ? `: ${stderr}` : ""}.`
      });
    }
  } else {
    skipped.push({ rule: "bash-syntax", message: "bash is not available on this machine; syntax check skipped." });
  }
  if (shellcheckAvailable()) {
    const err = spawnSync2("shellcheck", ["--severity=error", "--shell=bash", "--format=gcc", "-"], {
      input: bytes,
      stdio: ["pipe", "pipe", "ignore"]
    });
    if (err.status !== 0) {
      const lines = (err.stdout ? err.stdout.toString() : "").trim().split("\n").filter(Boolean);
      for (const line of lines) {
        errors.push({ rule: "shellcheck", message: line.replace(/^-:/, "") });
      }
      if (lines.length === 0) {
        errors.push({ rule: "shellcheck", message: `shellcheck --severity=error failed (exit ${String(err.status)}).` });
      }
    }
    const warn = spawnSync2("shellcheck", ["--severity=warning", "--shell=bash", "--format=gcc", "-"], {
      input: bytes,
      stdio: ["pipe", "pipe", "ignore"]
    });
    if (warn.status !== 0) {
      const lines = (warn.stdout ? warn.stdout.toString() : "").trim().split("\n").filter(Boolean);
      const errorSet = new Set(errors.map((e) => e.message));
      for (const line of lines) {
        const msg = line.replace(/^-:/, "");
        if (!errorSet.has(msg)) warnings.push({ rule: "shellcheck", message: msg });
      }
    }
  } else {
    skipped.push({
      rule: "shellcheck",
      message: "shellcheck is not installed; static analysis skipped (brew install shellcheck)."
    });
  }
  if (/^\s*read\s+(-[a-zA-Z]*p|.*\s-p\s)/m.test(text) || /\bselect\s+\w+\s+in\b/.test(text)) {
    warnings.push({
      rule: "no-interactivity",
      message: "interactive prompt detected (`read -p` / `select`) \u2014 forged tools must fail fast instead of prompting."
    });
  }
  if (/--(token|password|secret|api-key)[= ]/i.test(text)) {
    warnings.push({
      rule: "no-secret-flags",
      message: "a --token/--password/--secret style flag appears \u2014 secrets travel via files or stdin, never flags."
    });
  }
  return { errors, warnings, pending: [...PENDING_FORGE_RULES], skipped };
}
function renderLintReport(result) {
  const lines = [];
  for (const e of result.errors) lines.push(`error   ${e.rule}: ${e.message}`);
  for (const w of result.warnings) lines.push(`warning ${w.rule}: ${w.message}`);
  for (const s of result.skipped) lines.push(`skipped ${s.rule}: ${s.message}`);
  return lines.length ? lines.join("\n") + "\n" : "";
}
function runLint({ file }) {
  if (!existsSync2(file)) {
    process.stderr.write(`Error: ${file} does not exist.
`);
    return 1;
  }
  let bytes;
  try {
    bytes = readFileSync3(file);
  } catch (err) {
    process.stderr.write(`Error: could not read ${file}: ${err.message}
`);
    return 1;
  }
  const result = lintGate(bytes, file);
  const report = renderLintReport(result);
  if (report) process.stdout.write(report);
  process.stdout.write(
    `pending (forge rule pack, awaiting eslint-sh): ${result.pending.join(", ")}
` + (result.errors.length ? `FAIL: ${String(result.errors.length)} error(s) \u2014 fix in staging and re-run.
` : `PASS${result.warnings.length ? ` with ${String(result.warnings.length)} warning(s)` : ""}.
`)
  );
  return result.errors.length ? 1 : 0;
}

// src/commands/approve.ts
function killAfter(step) {
  if (process.env["TOOLSMITH_APPROVE_KILL_AFTER"] === step) {
    process.stderr.write(`[toolsmith-approve test fault injection] killed after step "${step}"
`);
    process.exit(9);
  }
}
function maybeCorruptRegistryForTest(regPath) {
  if (process.env["TOOLSMITH_APPROVE_CORRUPT_REGISTRY_STEP6"] === "1") {
    writeFileSync2(regPath, "not valid json {{{ this simulates corruption", "utf8");
  }
}
function migrateProtection(registry, scope) {
  const notes = [];
  for (const tool of registry.tools) {
    if (!tool || tool.status !== "approved" || typeof tool.path !== "string") continue;
    const normalized = scope.normalize(tool.path);
    if (!normalized) continue;
    const abs = scope.scriptAbs(normalized);
    if (!existsSync3(abs)) continue;
    let mode;
    try {
      mode = statSync(abs).mode & 511;
    } catch {
      continue;
    }
    if (mode === 365) continue;
    try {
      chmodSync(abs, 365);
    } catch (err) {
      notes.push(`Warning: could not protect pre-existing live tool ${abs}: ${err.message}`);
      continue;
    }
    const flagResult = tryChflags("uchg", abs);
    notes.push(
      flagResult.ok ? `Migrated pre-existing live tool ${abs} to 0555 + uchg.` : `Migrated pre-existing live tool ${abs} to 0555 (uchg unavailable: ${flagResult.reason}).`
    );
  }
  return notes;
}
function runApprove({ rawPath, commit, userScope }) {
  const resolution = resolveScope(userScope);
  if (!resolution.ok) {
    process.stderr.write(resolution.error);
    return 1;
  }
  const scope = resolution.scope;
  const path = scope.normalize(rawPath);
  if (!path) {
    process.stderr.write(scope.invalidPathMessage(rawPath));
    return 1;
  }
  const regPath = scope.regPath;
  if (!existsSync3(regPath)) {
    process.stderr.write(
      `Error: no registry found at ${regPath}. Create a draft entry first \u2014 see skills/toolsmith/references/registry-schema.md. Nothing written.
`
    );
    return 1;
  }
  const registry = readRegistry(regPath);
  if (!registry) {
    process.stderr.write(
      `Error: ${regPath} is not a valid registry (malformed JSON or missing "tools" array). Nothing written.
`
    );
    return 1;
  }
  const idx = registry.tools.findIndex((t) => t && t.path === path);
  if (idx === -1) {
    process.stderr.write(
      `Error: no registry entry found with path "${path}". This tool only pins the hash and grants the permission \u2014 it does not invent name/purpose/args/scope/covers. Author a draft entry first (see skills/toolsmith/references/registry-schema.md). Nothing written.
`
    );
    return 1;
  }
  const entry = registry.tools[idx];
  const staged = entry.staged;
  if (!staged || typeof staged !== "object" || typeof staged.path !== "string") {
    process.stderr.write(
      `Error: registry entry "${path}" has no "staged" draft to promote. Author the draft under the staging namespace and add a "staged" field to the entry first \u2014 see skills/toolsmith/references/registry-schema.md. Nothing written.
`
    );
    return 1;
  }
  const stagedRelPath = scope.normalizeStaged(staged.path);
  if (!stagedRelPath) {
    process.stderr.write(scope.invalidStagedPathMessage(staged.path));
    return 1;
  }
  const stagedAbs = scope.stagedAbs(stagedRelPath);
  if (!existsSync3(stagedAbs)) {
    process.stderr.write(`Error: staged draft not found at ${stagedAbs}. Nothing written.
`);
    return 1;
  }
  let stagedBytes;
  try {
    stagedBytes = readFileSync4(stagedAbs);
  } catch (err) {
    process.stderr.write(`Error: could not read ${stagedAbs}: ${err.message}. Nothing written.
`);
    return 1;
  }
  const stagedSha = sha256OfBytes(stagedBytes);
  const lint = lintGate(stagedBytes, stagedAbs);
  if (lint.errors.length > 0) {
    process.stderr.write(
      `Error: the staged draft fails the proposal gate (toolsmith lint). Fix it in staging and re-run.
` + renderLintReport(lint) + `Nothing written.
`
    );
    return 1;
  }
  const lintNotes = lint.warnings.map((w) => `Lint warning: ${w.rule}: ${w.message}`);
  const liveAbs = scope.scriptAbs(path);
  const isRevision = existsSync3(liveAbs);
  let liveTextBefore = "";
  if (isRevision) {
    try {
      liveTextBefore = readFileSync4(liveAbs, "utf8");
    } catch {
      liveTextBefore = "";
    }
  }
  const rule = scope.ruleFor(path, liveAbs);
  const settingsFile = scope.settingsFile;
  const settingsExists = existsSync3(settingsFile);
  const existingSettings = settingsExists ? readRegistrylike(settingsFile) : {};
  const settingsMalformed = settingsExists && existingSettings === null;
  const allowList = existingSettings && Array.isArray(existingSettings.permissions?.allow) ? existingSettings.permissions.allow : null;
  const alreadyGranted = allowList !== null && allowList.includes(rule);
  if (!commit) {
    const reviewSurface = isRevision ? unifiedLineDiff(liveTextBefore, stagedBytes.toString("utf8")) : stagedBytes.toString("utf8");
    process.stdout.write(
      [
        `Tool: ${entry.name ?? "(unnamed)"}`,
        `Kind: ${isRevision ? "revision (diff against current live)" : "new tool (full text)"}`,
        `Live path: ${scope.displayPath(path, liveAbs)}`,
        `Staged draft: ${staged.path}${staged.note ? ` \u2014 ${staged.note}` : ""}`,
        `Computed sha256 (staged): ${stagedSha}`,
        `Permission rule: ${rule}`,
        `Already in settings.json: ${settingsMalformed ? "unknown (settings.json is not valid JSON \u2014 the commit run will refuse until it is fixed)" : alreadyGranted ? "yes" : "no"}`,
        ...lintNotes,
        "",
        "--- review surface ---",
        reviewSurface,
        "--- end review surface ---",
        "",
        "DRY RUN \u2014 nothing written; re-run without --dry-run to apply."
      ].join("\n") + "\n"
    );
    return 0;
  }
  const settingsCheck = readSettingsStrict(settingsFile);
  if (!settingsCheck.ok) {
    process.stderr.write(`Error: ${settingsCheck.reason} Nothing written.
`);
    return 1;
  }
  const migrationNotes = migrateProtection(registry, scope);
  if (isRevision && chflagsAvailable()) {
    const nouchgResult = tryChflags("nouchg", liveAbs);
    if (!nouchgResult.ok) {
      process.stderr.write(
        [
          `Error: could not clear the immutable flag before promotion.`,
          `  path: ${liveAbs}`,
          `  flag: uchg (chflags nouchg failed: ${nouchgResult.reason})`,
          `  Live is untouched \u2014 nothing was written.`,
          `  Remedy: run \`chflags nouchg ${liveAbs}\` by hand to diagnose (permissions, ownership), then re-run approve.`
        ].join("\n") + "\n"
      );
      return 1;
    }
  }
  killAfter("nouchg");
  try {
    atomicWrite(liveAbs, stagedBytes);
  } catch (err) {
    process.stderr.write(
      `Error: could not place the staged bytes at ${liveAbs}: ${err.message}. The place step is atomic (write to a temp file, then rename) \u2014 it either fully happens or not at all, and it did not: live is unchanged. Fix the underlying issue (disk space, parent directory permissions) and re-run approve.
`
    );
    return 1;
  }
  killAfter("place");
  try {
    chmodSync(liveAbs, 365);
  } catch (err) {
    process.stderr.write(
      `Error: staged bytes were placed at ${liveAbs} but chmod 0555 failed: ${err.message}. Live now holds the new bytes but is neither mode-protected nor re-pinned; its hash no longer matches the registered pin, so invocation already fails closed. Re-run approve to converge.
`
    );
    return 1;
  }
  const uchgResult = tryChflags("uchg", liveAbs);
  killAfter("mode");
  let placedBytes;
  try {
    placedBytes = readFileSync4(liveAbs);
  } catch (err) {
    process.stderr.write(
      `Error: promotion placed ${liveAbs} but it could not be re-read to pin the hash: ${err.message}. Live is now in an unpinned state \u2014 re-run approve to converge.
`
    );
    return 1;
  }
  const placedSha = sha256OfBytes(placedBytes);
  const pinnedEntry = {
    ...entry,
    status: "approved",
    approvedSha256: placedSha,
    permissionRule: rule
  };
  const toolsWithPin = registry.tools.slice();
  toolsWithPin[idx] = pinnedEntry;
  atomicWrite(regPath, toJsonFile({ ...registry, tools: toolsWithPin }));
  killAfter("pin");
  const settingsBefore = settingsCheck.value;
  const permissionsBefore = settingsBefore["permissions"] && typeof settingsBefore["permissions"] === "object" ? settingsBefore["permissions"] : {};
  const allowBefore = Array.isArray(permissionsBefore["allow"]) ? permissionsBefore["allow"] : [];
  const allowAfter = allowBefore.includes(rule) ? allowBefore : [...allowBefore, rule];
  atomicWrite(
    settingsFile,
    toJsonFile({
      ...settingsBefore,
      permissions: { ...permissionsBefore, allow: allowAfter }
    })
  );
  killAfter("rule");
  maybeCorruptRegistryForTest(regPath);
  let registryAfterRule = readRegistry(regPath);
  let staleRegistryNote = null;
  if (!registryAfterRule) {
    staleRegistryNote = `Warning: ${regPath} could not be re-read as a valid registry after the rule was granted (missing "tools" array \u2014 concurrent edit or corruption?); falling back to this promotion's in-memory state to clear "staged". Re-run approve if the registry looks wrong afterward.`;
    registryAfterRule = { ...registry, tools: toolsWithPin };
  }
  const idxAfterRule = registryAfterRule.tools.findIndex((t) => t && t.path === path);
  const finalTools = registryAfterRule.tools.slice();
  if (idxAfterRule !== -1) {
    const { staged: _staged, ...withoutStaged } = registryAfterRule.tools[idxAfterRule];
    finalTools[idxAfterRule] = withoutStaged;
  }
  atomicWrite(regPath, toJsonFile({ ...registryAfterRule, tools: finalTools }));
  try {
    if (existsSync3(stagedAbs)) unlinkSync(stagedAbs);
  } catch (err) {
    process.stderr.write(`Warning: could not remove staged draft ${stagedAbs}: ${err.message}
`);
  }
  process.stdout.write(
    [
      ...migrationNotes,
      ...staleRegistryNote ? [staleRegistryNote] : [],
      ...lintNotes,
      `Promoted ${staged.path} -> ${scope.displayPath(path, liveAbs)}`,
      `Pinned: status=approved, approvedSha256=${placedSha}`,
      `permissionRule set to: ${rule}`,
      allowBefore.includes(rule) ? `Rule already present in ${settingsFile} (no-op).` : `Added rule to ${settingsFile} permissions.allow.`,
      `Live file mode: 0555${uchgResult.ok ? " + uchg" : ` (uchg unavailable: ${uchgResult.reason})`}.`,
      `Staging draft removed.`
    ].join("\n") + "\n"
  );
  return 0;
}
function readRegistrylike(path) {
  try {
    return JSON.parse(readFileSync4(path, "utf8"));
  } catch {
    return null;
  }
}

// src/commands/verify.ts
import { existsSync as existsSync4 } from "node:fs";
function verifyTool(tool, scope) {
  const name = tool?.name ?? "(unnamed)";
  const rawToolPath = tool?.path ?? "(no path)";
  if (tool?.status !== "approved") {
    return { status: "draft", name, path: rawToolPath };
  }
  const path = scope.normalize(rawToolPath);
  if (!path) {
    return { status: "MISSING", name, path: rawToolPath };
  }
  const abs = scope.scriptAbs(path);
  if (!existsSync4(abs)) {
    return { status: "MISSING", name, path };
  }
  let sha;
  try {
    sha = sha256OfFile(abs);
  } catch {
    return { status: "MISSING", name, path };
  }
  return sha === tool.approvedSha256 ? { status: "OK", name, path } : { status: "DRIFTED", name, path };
}
var STATUS_PAD = {
  OK: "OK       ",
  DRIFTED: "DRIFTED  ",
  MISSING: "MISSING  ",
  draft: "draft    "
};
function runVerify({ rawPath, userScope }) {
  const resolution = resolveScope(userScope);
  if (!resolution.ok) {
    process.stderr.write(resolution.error);
    return 1;
  }
  const scope = resolution.scope;
  const regPath = scope.regPath;
  if (!existsSync4(regPath)) {
    process.stderr.write(`Error: no registry found at ${regPath}.
`);
    return 1;
  }
  const registry = readRegistry(regPath);
  if (!registry) {
    process.stderr.write(`Error: ${regPath} is not a valid registry (malformed JSON or missing "tools" array).
`);
    return 1;
  }
  let filterPath = null;
  if (rawPath) {
    filterPath = scope.normalize(rawPath);
    if (!filterPath) {
      process.stderr.write(`Error: invalid path "${rawPath}".
`);
      return 1;
    }
  }
  const tools = filterPath ? registry.tools.filter((t) => t && t.path === filterPath) : registry.tools;
  if (filterPath && tools.length === 0) {
    process.stderr.write(`Error: no registry entry found with path "${filterPath}".
`);
    return 1;
  }
  let anyBad = false;
  for (const tool of tools) {
    const line = verifyTool(tool, scope);
    if (line.status === "DRIFTED" || line.status === "MISSING") anyBad = true;
    process.stdout.write(`${STATUS_PAD[line.status]}${line.name}	${line.path}
`);
  }
  return anyBad ? 1 : 0;
}

// src/commands/list.ts
import { existsSync as existsSync5 } from "node:fs";
function buildScopeReport(label, scope) {
  const regPath = scope.regPath;
  if (!existsSync5(regPath)) {
    return { label, regPath, parseError: false, absent: true, tools: [], drafts: [] };
  }
  const registry = readRegistry(regPath);
  if (!registry) {
    const parsed = readJsonOrNull(regPath);
    const parseError = !isPlainObject(parsed) || !Array.isArray(parsed["tools"]);
    return { label, regPath, parseError, absent: false, tools: [], drafts: [] };
  }
  const tools = registry.tools.filter((t) => Boolean(t)).map((entry) => {
    const line = verifyTool(entry, scope);
    return { entry, verify: line.status, verifiedPath: line.path };
  });
  const drafts = registry.tools.filter((t) => Boolean(t?.staged) && typeof t?.staged?.path === "string").map((entry) => {
    const staged = entry.staged;
    const stagedRel = scope.normalizeStaged(staged.path);
    const stagedAbs = stagedRel ? scope.stagedAbs(stagedRel) : null;
    let state;
    if (!stagedAbs || !existsSync5(stagedAbs)) {
      state = "staged-missing";
    } else if (entry.status !== "approved") {
      state = "new";
    } else {
      const line = verifyTool(entry, scope);
      state = line.status === "OK" ? "pending" : "live-drifted-too";
    }
    return { entry, state };
  });
  return { label, regPath, parseError: false, absent: false, tools, drafts };
}
function mdEscape(value) {
  return String(value ?? "").replace(/`/g, "'").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function renderScope(report, shadowedNames) {
  const lines = [];
  lines.push(`## ${report.label} tools`);
  lines.push("");
  if (report.parseError) {
    lines.push(
      `**PARSE ERROR:** \`${report.regPath}\` exists but does not parse as a registry (malformed JSON or missing \`tools\` array). The hook fails open on a malformed registry, so the redirect and tamper block for this scope are silently disarmed until the JSON is fixed.`
    );
    lines.push("");
    return lines;
  }
  if (report.absent) {
    lines.push(`No registry at \`${report.regPath}\` \u2014 no ${report.label.toLowerCase()} tools registered.`);
    lines.push("");
    return lines;
  }
  if (report.tools.length === 0) {
    lines.push(`Registry present at \`${report.regPath}\` but it lists no tools.`);
    lines.push("");
    return lines;
  }
  lines.push(`| name | path | status | integrity | purpose | args |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const t of report.tools) {
    const shadowNote = report.label === "User" && typeof t.entry.name === "string" && shadowedNames.has(t.entry.name) ? " (shadowed by project tool)" : "";
    lines.push(
      `| ${mdEscape(t.entry.name)}${shadowNote} | \`${mdEscape(t.entry.path)}\` | ${mdEscape(t.entry.status)} | ${t.verify} | ${mdEscape(t.entry.purpose)} | \`${mdEscape(t.entry.args)}\` |`
    );
  }
  lines.push("");
  if (report.drafts.length > 0) {
    lines.push(`### Pending drafts (${report.label.toLowerCase()} scope)`);
    lines.push("");
    lines.push(`| name | note | since | state |`);
    lines.push(`|---|---|---|---|`);
    for (const d of report.drafts) {
      lines.push(
        `| ${mdEscape(d.entry.name)} | ${mdEscape(d.entry.staged?.note)} | ${mdEscape(d.entry.staged?.since)} | ${d.state} |`
      );
    }
    lines.push("");
    if (d3(report.drafts, "live-drifted-too")) {
      lines.push(
        `**Warning:** at least one entry is \`live-drifted-too\` \u2014 live itself no longer matches its pin, so promoting now would be reviewing a stale diff. Re-verify live first.`
      );
      lines.push("");
    }
    if (d3(report.drafts, "staged-missing")) {
      lines.push(
        `**Warning:** at least one entry is \`staged-missing\` \u2014 the registry claims a pending draft whose staged file does not exist on disk.`
      );
      lines.push("");
    }
  }
  return lines;
}
function d3(drafts, state) {
  return drafts.some((d) => d.state === state);
}
function countByStatus(report) {
  const counts = { OK: 0, DRIFTED: 0, MISSING: 0, draft: 0 };
  for (const t of report.tools) counts[t.verify] += 1;
  return counts;
}
function summaryLine(label, report) {
  const c = countByStatus(report);
  return `- **${label}**: ${String(report.tools.length)} tool(s) \u2014 ${String(c.OK)} OK, ${String(c.DRIFTED)} drifted, ${String(c.MISSING)} missing, ${String(c.draft)} draft; ${String(report.drafts.length)} pending draft(s).`;
}
function runList() {
  const root = projectRoot();
  const home = resolveHome();
  const conflated = Boolean(home) && sameFile(registryPathFor(root), userRegistryPath(home));
  const reports = [];
  if (!conflated) {
    const projectScope = resolveScope(false);
    if (projectScope.ok) reports.push(buildScopeReport("Project", projectScope.scope));
  }
  const userScope = resolveScope(true);
  if (userScope.ok) reports.push(buildScopeReport("User", userScope.scope));
  const projectReport = reports.find((r) => r.label === "Project");
  const shadowedNames = new Set(
    (projectReport?.tools ?? []).map((t) => t.entry.name).filter((n) => typeof n === "string")
  );
  const lines = ["# Toolsmith registry", ""];
  if (conflated) {
    lines.push(
      `_This session's project root is the home directory, so the project and user registries are the same file \u2014 reported once, as user scope._`,
      ""
    );
  }
  for (const report of reports) {
    lines.push(...renderScope(report, shadowedNames));
  }
  const userReport = reports.find((r) => r.label === "User");
  const shadowed = (userReport?.tools ?? []).filter(
    (t) => typeof t.entry.name === "string" && shadowedNames.has(t.entry.name)
  );
  if (shadowed.length > 0) {
    lines.push(
      `_A project tool shadows a same-named user tool: ${shadowed.map((t) => `\`${String(t.entry.name)}\``).join(", ")} \u2014 the project entry governs while this project is active._`,
      ""
    );
  }
  lines.push("## Summary", "");
  for (const report of reports) lines.push(summaryLine(report.label, report));
  lines.push("");
  process.stdout.write(lines.join("\n"));
  const anyBad = reports.some(
    (r) => r.parseError || r.tools.some((t) => t.verify === "DRIFTED" || t.verify === "MISSING")
  );
  return anyBad ? 1 : 0;
}

// src/commands/analyze.ts
import { existsSync as existsSync6, readFileSync as readFileSync5 } from "node:fs";
import { join as join4 } from "node:path";

// src/lib/watchlist.ts
import { realpathSync as realpathSync2 } from "node:fs";
import { dirname as dirname2, join as join3 } from "node:path";
function bundledDefaults() {
  try {
    return true ? JSON.parse(`{
  "_comment": "Default watchlist for the toolsmith PreToolUse redirect hook. Each 'pattern' is a JavaScript RegExp (tested against the raw Bash command string). A watched command is only ever DENIED when an approved registry tool's 'covers' pattern also matches it; a watched command with no covering tool passes through to the normal permission flow. This set is overridden via .claude/toolsmith/config.json ({\\"watchlist\\": {\\"add\\": [...], \\"remove\\": [...]}}), layered broad->specific: these shipped defaults, then the user-scope config (~/.claude/toolsmith/config.json), then the project-scope config (<projectRoot>/.claude/toolsmith/config.json) -- 'add' unions in and 'remove' subtracts at each layer, so a project can remove a pattern the user config added, and a user config can remove one of these shipped defaults globally. 'remove' entries must match verbatim a pattern string already present at that point in the merge (a default here, or a broader layer's 'add'), not only these shipped defaults.",
  "watchlist": [
    {
      "pattern": "(^|[|&;( ])gh(_\\\\w+)?\\\\s+api\\\\b",
      "rationale": "gh api makes arbitrary authenticated REST calls with the CLI's full credentials \u2014 the classic broad escape hatch. Narrow read operations belong in a purpose-built, allowlistable script. Also matches wrapper binaries such as gh_dotcom (a common wrapper pinning gh to github.com) so the redirect can't be bypassed by using the wrapper's name instead of gh."
    },
    {
      "pattern": "(^|[|&;( ])gh(_\\\\w+)?\\\\s+graphql\\\\b",
      "rationale": "gh graphql runs arbitrary authenticated GraphQL against GitHub \u2014 same broad-power concern as gh api, including wrapper binaries such as gh_dotcom."
    },
    {
      "pattern": "(^|[|&;( ])curl\\\\b(?!.*(localhost|127\\\\.0\\\\.0\\\\.1))",
      "rationale": "curl to a non-local host is an unbounded network fetch/post. Recurring API reads should become a scoped script rather than a hand-rolled request."
    },
    {
      "pattern": "(^|[|&;( ])wget\\\\b(?!.*(localhost|127\\\\.0\\\\.0\\\\.1))",
      "rationale": "wget to a non-local host is an unbounded network fetch \u2014 same concern as curl."
    },
    {
      "pattern": "(^|[|&;( ])aws\\\\s+",
      "rationale": "The raw aws CLI spans every AWS service and mutation. A specific recurring query should be a bounded script, not a broadly allowlisted aws command."
    },
    {
      "pattern": "(^|[|&;( ])gcloud\\\\s+",
      "rationale": "The raw gcloud CLI spans all of Google Cloud. Narrow recurring operations should be scripted and scoped."
    },
    {
      "pattern": "(^|[|&;( ])kubectl\\\\s+",
      "rationale": "kubectl can read and mutate any cluster resource. Recurring inspections should be captured as read-only scoped scripts."
    },
    {
      "pattern": "(^|[|&;( ])op\\\\s+(read|item|document|get)\\\\b",
      "rationale": "The 1Password CLI reads secrets. Any recurring secret access should be a single, reviewed, tightly-scoped script rather than an allowlisted op command."
    }
  ]
}
`) : null;
  } catch {
    return null;
  }
}
function defaultWatchlistPath() {
  const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
  const rel = ["skills", "toolsmith", "references", "watchlist-defaults.json"];
  if (pluginRoot) return join3(pluginRoot, ...rel);
  const argv1 = process.argv[1];
  if (!argv1) return null;
  try {
    return join3(dirname2(realpathSync2(argv1)), "..", ...rel);
  } catch {
    return join3(dirname2(argv1), "..", ...rel);
  }
}
function applyWatchlistLayer(patterns, config) {
  const layer = isPlainObject(config) ? config : {};
  const remove = new Set(
    Array.isArray(layer.watchlist?.remove) ? layer.watchlist.remove.filter((p) => typeof p === "string") : []
  );
  const add = Array.isArray(layer.watchlist?.add) ? layer.watchlist.add.filter((p) => typeof p === "string") : [];
  return [.../* @__PURE__ */ new Set([...patterns.filter((p) => !remove.has(p)), ...add])];
}
function effectiveWatchlistPatterns(userConfigPath, projectConfigPath) {
  const defaultsPath = defaultWatchlistPath();
  const defaults = (defaultsPath ? readJsonOrNull(defaultsPath) : null) ?? bundledDefaults();
  const watchlist = isPlainObject(defaults) ? defaults["watchlist"] : null;
  const defaultPatterns = Array.isArray(watchlist) ? watchlist.map((e) => isPlainObject(e) ? e["pattern"] : null).filter((p) => typeof p === "string") : [];
  let patterns = defaultPatterns;
  const userConfig = userConfigPath ? readJsonOrNull(userConfigPath) : null;
  const projectConfig = readJsonOrNull(projectConfigPath);
  for (const config of [userConfig, projectConfig]) {
    patterns = applyWatchlistLayer(patterns, config);
  }
  return patterns;
}
function toRegExp(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}
function safeTest(re, s) {
  if (!re) return false;
  try {
    return re.test(s);
  } catch {
    return false;
  }
}

// src/commands/analyze.ts
function redactSecrets(text) {
  return text.replace(
    // Environment-style assignments whose variable name smells like a
    // credential (`AWS_SECRET_ACCESS_KEY=… aws s3 ls`): the unquoted value
    // survives normalization (it is neither a quoted string nor a --flag
    // value), so it must be masked by name here.
    /\b([A-Za-z_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?|AUTH)[A-Za-z_]*=)[^\s|;&]+/gi,
    "$1<redacted>"
  ).replace(/\b(Bearer|token|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 <redacted>").replace(/\b(gh[pousr]_[A-Za-z0-9]{8,})/g, "<redacted>").replace(/\b(xox[a-z]-[A-Za-z0-9-]{8,})/g, "<redacted>").replace(/\b(sk-[A-Za-z0-9-]{16,})/g, "<redacted>").replace(/\b(AKIA[A-Z0-9]{12,})/g, "<redacted>").replace(/(--?(?:token|password|secret|api-key|apikey)[= ])\S+/gi, "$1<redacted>");
}
function normalizeCommand(command) {
  let s = command.replace(/\s+/g, " ").trim();
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '"\u2026"').replace(/'[^']*'/g, "'\u2026'");
  s = s.replace(/(--[A-Za-z0-9-]+=)[^\s]+/g, "$1\u2026");
  s = s.replace(/<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?[\s\S]*$/g, "<<$1 \u2026");
  s = s.replace(/\b(https?:\/\/[^\s/]+)\/[^\s]*/g, "$1/\u2026");
  s = s.replace(/\b[0-9a-f]{7,64}\b/g, "HEX");
  s = s.replace(/\b\d{2,}\b/g, "N");
  return s;
}
function parseHistory(historyPath) {
  let raw;
  try {
    raw = readFileSync5(historyPath, "utf8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isPlainObject(parsed)) continue;
    const command = parsed["command"];
    if (typeof command !== "string" || !command.trim()) continue;
    const ts = typeof parsed["ts"] === "string" ? parsed["ts"] : null;
    const exitCode = typeof parsed["exitCode"] === "number" ? parsed["exitCode"] : null;
    entries.push({ ts, command, exitCode });
  }
  return entries;
}
function approvedTools() {
  const root = projectRoot();
  const home = resolveHome();
  const projectRegPath = registryPathFor(root);
  const conflated = Boolean(home) && sameFile(projectRegPath, userRegistryPath(home));
  const registries = [
    ...conflated ? [] : [readRegistry(projectRegPath)],
    ...home ? [readRegistry(userRegistryPath(home))] : []
  ];
  const tools = [];
  for (const registry of registries) {
    for (const tool of registry?.tools ?? []) {
      if (!tool || tool.status !== "approved") continue;
      const covers = (Array.isArray(tool.covers) ? tool.covers : []).map((p) => typeof p === "string" ? toRegExp(p) : null).filter((r) => r !== null);
      tools.push({ name: typeof tool.name === "string" ? tool.name : "(unnamed)", covers });
    }
  }
  return tools;
}
var TOP_CLUSTERS = 20;
function runAnalyze() {
  const root = projectRoot();
  const historyPath = join4(root, ".claude", "toolsmith", "history.jsonl");
  if (!existsSync6(historyPath)) {
    process.stdout.write(
      `# Toolsmith usage analysis

No history log at \`${historyPath}\` \u2014 not enough signal yet. The PostToolUse logger populates it as Bash commands run.
`
    );
    return 0;
  }
  const entries = parseHistory(historyPath);
  if (entries.length === 0) {
    process.stdout.write(
      `# Toolsmith usage analysis

History log at \`${historyPath}\` is empty or unparseable \u2014 not enough signal yet.
`
    );
    return 0;
  }
  const home = resolveHome();
  const watchlist = effectiveWatchlistPatterns(
    home ? join4(home, ".claude", "toolsmith", "config.json") : null,
    join4(root, ".claude", "toolsmith", "config.json")
  ).map((p) => toRegExp(p, "m")).filter((r) => r !== null);
  const tools = approvedTools();
  const clusters = /* @__PURE__ */ new Map();
  let watchedTotal = 0;
  for (const entry of entries) {
    const signature = redactSecrets(normalizeCommand(entry.command));
    const watched = watchlist.some((re) => safeTest(re, entry.command));
    if (watched) watchedTotal++;
    const coveredBy = tools.filter((t) => t.covers.some((re) => safeTest(re, entry.command))).map((t) => t.name);
    const stages = entry.command.split(/\|\||&&|[|;&\n]/).length;
    const existing = clusters.get(signature);
    if (existing) {
      existing.count++;
      if (entry.exitCode !== null && entry.exitCode !== 0) existing.failures++;
      if (entry.ts && (!existing.lastTs || entry.ts > existing.lastTs)) existing.lastTs = entry.ts;
      if (entry.ts && (!existing.firstTs || entry.ts < existing.firstTs)) existing.firstTs = entry.ts;
      existing.watched = existing.watched || watched;
      for (const name of coveredBy) if (!existing.coveredBy.includes(name)) existing.coveredBy.push(name);
    } else {
      clusters.set(signature, {
        signature,
        count: 1,
        failures: entry.exitCode !== null && entry.exitCode !== 0 ? 1 : 0,
        firstTs: entry.ts,
        lastTs: entry.ts,
        stages,
        watched,
        coveredBy
      });
    }
  }
  const interesting = [...clusters.values()].filter((c) => c.count >= 3 || c.watched || c.stages >= 3).sort((a, b) => b.count - a.count || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0)).slice(0, TOP_CLUSTERS);
  const uncoveredWatched = interesting.filter((c) => c.watched && c.coveredBy.length === 0);
  const lines = [
    `# Toolsmith usage analysis`,
    ``,
    `Deterministic facts mined from \`.claude/toolsmith/history.jsonl\` \u2014 ${String(entries.length)} logged command(s), ${String(clusters.size)} distinct shape(s), ${String(watchedTotal)} watched invocation(s). Examples below are normalized and secret-redacted; the raw log is local, gitignored, and sensitive \u2014 do not copy it elsewhere.`,
    ``,
    `## Command clusters (top ${String(Math.min(TOP_CLUSTERS, interesting.length))}: repeated \u22653\xD7, watched, or \u22653 pipeline stages)`,
    ``
  ];
  if (interesting.length === 0) {
    lines.push(`Nothing repeated, watched, or pipeline-heavy yet \u2014 not enough signal to propose tools.`, ``);
  } else {
    lines.push(`| count | fails | watched | covered by | stages | normalized command |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const c of interesting) {
      const sig = c.signature.length > 120 ? c.signature.slice(0, 117) + "\u2026" : c.signature;
      lines.push(
        `| ${String(c.count)} | ${String(c.failures)} | ${c.watched ? "yes" : "no"} | ${c.coveredBy.length ? c.coveredBy.map((n) => `\`${n}\``).join(", ") : "\u2014"} | ${String(c.stages)} | \`${sig.replace(/\|/g, "\\|").replace(/`/g, "'")}\` |`
      );
    }
    lines.push(``);
  }
  lines.push(`## Watched but uncovered`, ``);
  if (uncoveredWatched.length === 0) {
    lines.push(`Every watched cluster above is already covered by an approved tool (or nothing watched recurred).`, ``);
  } else {
    lines.push(
      `${String(uncoveredWatched.length)} cluster(s) match the effective watchlist but no approved tool's \`covers\` pattern \u2014 the primary candidates for forging:`,
      ``
    );
    for (const c of uncoveredWatched) {
      const sig = c.signature.length > 120 ? c.signature.slice(0, 117) + "\u2026" : c.signature;
      lines.push(`- ${String(c.count)}\xD7 \`${sig.replace(/`/g, "'")}\``);
    }
    lines.push(``);
  }
  lines.push(
    `---`,
    ``,
    `_Facts end here. Rubric judgment (Compound / Missing / Guarded / Permission-scopable, per \`skills/toolsmith/references/authoring-checklist.md\`) and script sketches are the agent's layer on top._`,
    ``
  );
  process.stdout.write(lines.join("\n"));
  return 0;
}

// src/main.ts
var VERSION = true ? "0.1.0" : "0.0.0";
var HELP = `toolsmith ${VERSION} \u2014 purpose-built-tool lifecycle for the toolsmith plugin

Usage:
  toolsmith approve <path> [--user] [--dry-run]   Promote a staged draft to live (see below)
  toolsmith verify [<path>] [--user]              Read-only integrity check of live pins
  toolsmith lint <file>                           Proposal gate: lint a staged draft
  toolsmith list                                  Registry inventory + drift, both scopes (markdown)
  toolsmith analyze                               Mine .claude/toolsmith/history.jsonl (markdown)
  toolsmith --help | --version

approve is the one trust boundary and its commit run is a HUMAN act: run it
in your own terminal after reading the --dry-run review surface. Agents may
only run --dry-run / verify / lint / list / analyze.

Run \`toolsmith <verb> --help\` for verb details.
`;
var APPROVE_HELP = `toolsmith approve \u2014 the staged/live promotion handshake (write side)

You are the human in this handshake. An agent authored a draft under the
staging namespace; nothing about it is executable or granted until YOU
promote it here, in your own terminal. Agents are denied the commit run by
the toolsmith PreToolUse hook \u2014 only --dry-run passes for them.

Usage:
  toolsmith approve <path>                Promote: place the staged draft as live, pin + grant
  toolsmith approve <path> --dry-run      Preview the promotion \u2014 read the review surface; no writes
  toolsmith approve <name-or-path> --user [--dry-run]
                                          Same, for a user-scope (global) tool

What to do:
  1. Run with --dry-run and READ the review surface \u2014 for a revision it is a
     diff against current live; for a new tool it is the full script text.
     What you review is exactly what is placed, byte for byte.
  2. If you approve of the script AND of granting the printed Bash(...) rule,
     re-run without --dry-run.

What the commit run does (deterministic, idempotent):
  - places the staged bytes at the live path (atomic write + rename)
  - sets the live file to mode 0555 (+ BSD immutable flag where available)
  - recomputes sha256 from the placed bytes and pins it in the registry
  - adds exactly one Bash(...) rule to the scope's settings.json allowlist
  - clears the entry's "staged" field and removes the staging file

<path> is a project-relative path naming a registry entry in
.claude/toolsmith/registry.json. With --user, pass a bare tool name or
"tools/<name>", resolved against ~/.claude/toolsmith/.

Fail-closed: any validation failure before placement writes nothing. If
interrupted mid-apply, live is refused-closed (its pin won't match) until you
re-run; re-running converges. Every future edit to a promoted tool goes back
through staging \u2014 live never accepts a direct edit.
`;
var VERIFY_HELP = `toolsmith verify \u2014 read-only integrity check of LIVE pins

Usage:
  toolsmith verify [--user] [<path>]

Prints one line per registry tool, prefixed with its status:
  OK       file present and sha256 matches the pinned approvedSha256
  DRIFTED  hash differs from the pinned value (the hook blocks invocation)
  MISSING  the file no longer exists (or its registry path is invalid)
  draft    not yet approved

Exit 0 when everything is OK/draft; exit 1 if anything DRIFTED or MISSING.
`;
var LINT_HELP = `toolsmith lint \u2014 the proposal gate for staged drafts

Usage:
  toolsmith lint <file>

Runs the same gate \`toolsmith approve\` enforces fail-closed: bash syntax
(bash -n), shellcheck error-severity findings (when installed), and draft
sanity (non-empty, text). Warnings (shebang, shellcheck warnings,
interactivity, secret-bearing flags) don't block; errors do. The forge rule
pack (docs/toolsmith/lint-rule-concepts.md) is pending eslint-sh and is
reported as such \u2014 never silently implied to have run.

Exit 0 on pass (warnings allowed), 1 on errors.
`;
var LIST_HELP = `toolsmith list \u2014 deterministic registry inventory (relay-markdown)

Usage:
  toolsmith list

Reads both registries (.claude/toolsmith/registry.json and
~/.claude/toolsmith/registry.json), verifies every live pin, and renders
per-scope tables plus pending staged drafts with a three-way drift state
(pending / live-drifted-too / staged-missing / new). A registry that exists
but won't parse is reported as a PARSE ERROR for that scope \u2014 the hook fails
open on malformed JSON, so the redirect/tamper block is disarmed until fixed.

Exit 0 when clean; exit 1 if anything is DRIFTED/MISSING or a registry
fails to parse.
`;
var ANALYZE_HELP = `toolsmith analyze \u2014 deterministic mining of the Bash history log

Usage:
  toolsmith analyze

Reads .claude/toolsmith/history.jsonl, clusters commands by normalized shape,
counts frequency/failures, and classifies each cluster against the effective
watchlist and approved tools' covers patterns. Output is relay-markdown of
FACTS only \u2014 the agent applies the authoring-checklist rubric on top.

The history log can contain inline secrets; every emitted example is
normalized and secret-redacted, and the raw log should never leave the
machine.
`;
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv[0] === "version") {
    process.stdout.write(`${VERSION}
`);
    process.exit(0);
  }
  const verb = argv[0];
  const rest = argv.slice(1);
  const wantsHelp = argv.includes("--help") || argv.includes("-h");
  if (!verb || wantsHelp && !verb.match(/^(approve|verify|lint|list|analyze)$/)) {
    process.stdout.write(HELP);
    process.exit(verb ? 0 : 1);
  }
  switch (verb) {
    case "approve": {
      if (wantsHelp) {
        process.stdout.write(APPROVE_HELP);
        process.exit(0);
      }
      const userScope = rest.includes("--user");
      const dryRun = rest.includes("--dry-run");
      const pathArgs = rest.filter((a) => a !== "--user" && a !== "--dry-run");
      if (pathArgs.length !== 1 || !pathArgs[0]) {
        process.stderr.write("Error: expected exactly one <path> argument.\n\n" + APPROVE_HELP);
        process.exit(1);
      }
      process.exit(runApprove({ rawPath: pathArgs[0], commit: !dryRun, userScope }));
      break;
    }
    case "verify": {
      if (wantsHelp) {
        process.stdout.write(VERIFY_HELP);
        process.exit(0);
      }
      const userScope = rest.includes("--user");
      const pathArgs = rest.filter((a) => a !== "--user");
      if (pathArgs.length > 1) {
        process.stderr.write("Error: verify takes at most one <path> argument.\n\n" + VERIFY_HELP);
        process.exit(1);
      }
      process.exit(runVerify({ rawPath: pathArgs[0], userScope }));
      break;
    }
    case "lint": {
      if (wantsHelp) {
        process.stdout.write(LINT_HELP);
        process.exit(0);
      }
      if (rest.length !== 1 || !rest[0]) {
        process.stderr.write("Error: expected exactly one <file> argument.\n\n" + LINT_HELP);
        process.exit(1);
      }
      process.exit(runLint({ file: rest[0] }));
      break;
    }
    case "list": {
      if (wantsHelp) {
        process.stdout.write(LIST_HELP);
        process.exit(0);
      }
      if (rest.length > 0) {
        process.stderr.write("Error: list takes no arguments.\n\n" + LIST_HELP);
        process.exit(1);
      }
      process.exit(runList());
      break;
    }
    case "analyze": {
      if (wantsHelp) {
        process.stdout.write(ANALYZE_HELP);
        process.exit(0);
      }
      if (rest.length > 0) {
        process.stderr.write("Error: analyze takes no arguments.\n\n" + ANALYZE_HELP);
        process.exit(1);
      }
      process.exit(runAnalyze());
      break;
    }
    default: {
      process.stderr.write(`Error: unknown verb "${verb}".

` + HELP);
      process.exit(1);
    }
  }
}
main();
