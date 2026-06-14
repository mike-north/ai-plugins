#!/usr/bin/env node
/**
 * Converts hooks YAML source files to JSON for platforms that require JSON configuration.
 *
 * For each plugin in plugins/, finds hooks/*.yaml files and writes corresponding hooks/*.json files.
 * Only YAML sources are committed to git; JSON files are generated and gitignored.
 *
 * A Claude-source YAML (typically hooks/claude.yaml) is emitted once for each of the
 * supported target formats:
 *
 *   - `claude` target → hooks/claude.json (Claude Code's native tool names, e.g. "Write")
 *   - `gemini` target → hooks/hooks.json (Gemini CLI native tool names, e.g. "write_file")
 *
 * Usage: pnpm run build:hooks
 *
 * @see https://geminicli.com/docs/extensions/reference/ — Gemini CLI hooks format
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");

export type HookTarget = "claude" | "gemini";

/**
 * Claude Code → Gemini CLI tool-name translations.
 * When emitting a Gemini-format hooks file, any `matcher: <ClaudeTool>` entry
 * is rewritten to the corresponding Gemini tool name.
 */
const CLAUDE_TO_GEMINI_TOOL_MATCHERS: Record<string, string> = {
  Read: "read_file",
  Write: "write_file",
  Edit: "replace",
  Glob: "glob",
  Grep: "search_file_content",
  Bash: "run_shell_command",
  Agent: "activate_skill",
};

/**
 * Claude Code → Gemini CLI hook EVENT-name translations (faithful equivalents).
 *
 * Hooks are authored once in `hooks/claude.yaml` using Claude's event vocabulary;
 * Gemini CLI uses a different vocabulary for the same lifecycle points, so the
 * event KEYS must be renamed when emitting `hooks.json` — not just the tool
 * matchers. Only semantically-equivalent pairs are mapped.
 *
 * @see https://code.claude.com/docs/en/hooks.md — Claude event names
 * @see https://geminicli.com/docs/hooks/ — Gemini event names
 */
const CLAUDE_TO_GEMINI_EVENTS: Record<string, string> = {
  PreToolUse: "BeforeTool", // before a tool executes
  PostToolUse: "AfterTool", // after a tool executes
  UserPromptSubmit: "BeforeAgent", // user submitted a prompt, before processing
  Stop: "AfterAgent", // the agent finished responding / the agent loop ended
  PreCompact: "PreCompress", // before context compaction/compression
};

/**
 * Event names valid on Gemini CLI under the SAME spelling (pass through unchanged).
 * @see https://geminicli.com/docs/hooks/
 */
const GEMINI_NATIVE_EVENTS = new Set([
  "SessionStart",
  "SessionEnd",
  "Notification",
  "BeforeAgent",
  "AfterAgent",
  "BeforeModel",
  "AfterModel",
  "BeforeToolSelection",
  "BeforeTool",
  "AfterTool",
  "PreCompress",
]);

/**
 * Resolve a Claude hook event name to its Gemini equivalent.
 * Returns the Gemini event name, or `null` if Gemini has no equivalent (the
 * event must be omitted from the Gemini hooks file — per the polyfill rule that
 * unsupported events degrade by omission, never by silent remap to a different
 * lifecycle point).
 */
export function geminiEventNameFor(claudeEvent: string): string | null {
  const mapped = CLAUDE_TO_GEMINI_EVENTS[claudeEvent];
  if (mapped !== undefined) return mapped;
  if (GEMINI_NATIVE_EVENTS.has(claudeEvent)) return claudeEvent;
  return null;
}

interface HookEntry {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface HookMatcher {
  matcher?: string;
  description?: string;
  hooks?: HookEntry[];
  [key: string]: unknown;
}

interface HooksFile {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

function isHooksFile(value: unknown): value is HooksFile {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-clone a hooks object and translate it from Claude's vocabulary to Gemini's:
 *   1. Event KEYS are renamed to their Gemini equivalent ({@link geminiEventNameFor});
 *      events with no Gemini equivalent are omitted (and reported via `onWarn`).
 *   2. `matcher` tool names are translated (Write → write_file, …); matchers with no
 *      mapping are preserved unchanged (they may be globs or non-tool identifiers).
 *
 * @param onWarn called once per omitted event (defaults to console.warn).
 */
export function translateHooksForGemini(
  source: HooksFile,
  onWarn: (message: string) => void = (m) => {
    console.warn(m);
  },
): HooksFile {
  const cloned = JSON.parse(JSON.stringify(source)) as HooksFile;
  const hooks = cloned.hooks;
  if (!hooks) return cloned;

  const translatedHooks: Record<string, HookMatcher[]> = {};
  for (const event of Object.keys(hooks)) {
    const matchers = hooks[event];
    if (!Array.isArray(matchers)) continue; // skip malformed (non-array) event values
    const geminiEvent = geminiEventNameFor(event);
    if (geminiEvent === null) {
      onWarn(`hook event "${event}" has no Gemini equivalent — omitted from hooks.json`);
      continue;
    }
    for (const m of matchers) {
      if (typeof m.matcher === "string") {
        const translated = CLAUDE_TO_GEMINI_TOOL_MATCHERS[m.matcher];
        if (translated !== undefined) {
          m.matcher = translated;
        }
      }
    }
    // Merge in case two Claude events map to the same Gemini event.
    const existing = translatedHooks[geminiEvent];
    if (existing) {
      existing.push(...matchers);
    } else {
      translatedHooks[geminiEvent] = matchers;
    }
  }

  cloned.hooks = translatedHooks;
  return cloned;
}

/**
 * Convert a single hooks YAML file for the given plugin to the requested target format.
 * Returns the output file basename (e.g. "claude.json" or "hooks.json") on success.
 */
export function convertHookFile(
  hooksDir: string,
  yamlFile: string,
  target: HookTarget,
): string {
  const yamlPath = path.join(hooksDir, yamlFile);
  const content = fs.readFileSync(yamlPath, "utf-8");
  const parsed: unknown = parseYaml(content);
  if (!isHooksFile(parsed)) {
    throw new Error(`${yamlPath}: expected top-level object with optional "hooks" key`);
  }

  if (target === "claude") {
    const outputName = yamlFile.replace(/\.ya?ml$/, ".json");
    const outputPath = path.join(hooksDir, outputName);
    fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
    return outputName;
  }

  // Gemini CLI canonically looks for `hooks/hooks.json`, regardless of source filename.
  const geminiShape = translateHooksForGemini(parsed);
  const outputName = "hooks.json";
  const outputPath = path.join(hooksDir, outputName);
  fs.writeFileSync(outputPath, JSON.stringify(geminiShape, null, 2) + "\n", "utf-8");
  return outputName;
}

/**
 * Build all hook JSON files for a single plugin. Emits one JSON file per target format
 * for each YAML source found. Returns the number of output files produced.
 */
export function buildHooksForPlugin(
  pluginDir: string,
  pluginName: string,
  targets: HookTarget[] = ["claude", "gemini"],
): number {
  const hooksDir = path.join(pluginDir, "hooks");
  if (!fs.existsSync(hooksDir)) return 0;

  const yamlFiles = fs
    .readdirSync(hooksDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  let count = 0;
  for (const yamlFile of yamlFiles) {
    for (const target of targets) {
      const outputName = convertHookFile(hooksDir, yamlFile, target);
      console.log(`  ${pluginName}/hooks/${yamlFile} → ${outputName} (${target})`);
      count++;
    }
  }

  return count;
}

function main(): void {
  if (!fs.existsSync(PLUGINS_DIR)) {
    console.error(`plugins/ directory not found at ${PLUGINS_DIR}`);
    process.exit(1);
  }

  const plugins = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  if (plugins.length === 0) {
    console.log("No plugins found in plugins/");
    return;
  }

  console.log("Building hooks (YAML → JSON):\n");

  let totalCount = 0;
  for (const plugin of plugins) {
    const pluginDir = path.join(PLUGINS_DIR, plugin);
    totalCount += buildHooksForPlugin(pluginDir, plugin);
  }

  if (totalCount === 0) {
    console.log("  No YAML hook files found.");
  }

  console.log(`\nConverted ${totalCount} hook file(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
