/**
 * Regression tests for the toolsmith PreToolUse/PostToolUse hook trio:
 * toolsmith-gate.sh + toolsmith-check.mjs (the "brain") + toolsmith-log.sh.
 *
 * This is a vitest port of plugins/toolsmith/scripts/test.sh. It drives the
 * real, unmodified hook scripts exactly as Claude Code does: the hook JSON
 * payload on stdin, via `bash <script>`, with CLAUDE_PROJECT_DIR pointed at a
 * temp project fixture and HOME pointed at a temp home dir so the real
 * ~/.claude/toolsmith on the machine running these tests is never touched.
 * The hook scripts themselves are not modified by or for this suite.
 *
 * Test-to-acceptance-criteria mapping for the staged/live split section (the
 * rest of that split's ACs -- AC1, AC4, AC5, AC7 -- are covered by
 * packages/toolsmith's approve-flow tests, not here):
 *   AC2 staged inert (both invocation routes)
 *   AC3 live write-denied (mode/uchg + hashDenial never silently runs)
 *   AC6 no hot-path regression (staging is invisible to the hook)
 *
 * @see /docs/toolsmith/staged-live-split.md
 * @see https://code.claude.com/docs/en/hooks.md
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(REPO_ROOT, "plugins", "toolsmith", "scripts", "toolsmith-gate.sh");
const LOG = join(REPO_ROOT, "plugins", "toolsmith", "scripts", "toolsmith-log.sh");

function hasCommand(cmd: string): boolean {
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}
const HAS_JQ = hasCommand("jq");
const HAS_CHFLAGS = hasCommand("chflags");

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function writeExecutable(path: string, content: string): string {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return sha256Hex(content);
}

/** Fresh env for spawning a hook script, isolated to the temp PROJ/HOME. */
function hookEnv(
  projectDir: string,
  home: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["CLAUDE_TOOLSMITH_HOOK"];
  env["CLAUDE_PROJECT_DIR"] = projectDir;
  env["HOME"] = home;
  Object.assign(env, extra);
  return env;
}

interface GateOptions {
  toolName?: string;
  hookEventName?: string;
  cwd?: string;
  projectDir?: string;
  extraEnv?: Record<string, string>;
}

let PROJ: string;
let USERHOME: string;

/** Drive the full PreToolUse pipeline exactly as Claude Code invokes it. */
function pre(command: string, opts: GateOptions = {}): string {
  const cwd = opts.cwd ?? PROJ;
  const payload = JSON.stringify({
    hook_event_name: opts.hookEventName ?? "PreToolUse",
    tool_name: opts.toolName ?? "Bash",
    cwd,
    tool_input: { command },
  });
  const r = spawnSync("bash", [GATE], {
    input: payload,
    env: hookEnv(opts.projectDir ?? PROJ, USERHOME, opts.extraEnv),
    encoding: "utf8",
  });
  return r.stdout;
}

/** Legacy pre-shim Cursor wiring: tool_name "Shell", hook_event_name "preToolUse". */
function preCursor(command: string): string {
  return pre(command, { toolName: "Shell", hookEventName: "preToolUse" });
}

/** A session whose CLAUDE_PROJECT_DIR (and payload cwd) IS $HOME itself. */
function preHomeroot(command: string): string {
  return pre(command, { cwd: USERHOME, projectDir: USERHOME });
}

function preMultiline(command: string): string {
  return pre(command);
}

function post(command: string, exitCode = 0, cwd = PROJ): void {
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    cwd,
    tool_input: { command },
    tool_response: { stdout: "", stderr: "", exitCode },
  });
  spawnSync("bash", [LOG], {
    input: payload,
    env: hookEnv(PROJ, USERHOME),
    encoding: "utf8",
  });
}

function postCursorShell(command: string, cwd = PROJ): void {
  const payload = JSON.stringify({
    hook_event_name: "postToolUse",
    tool_name: "Shell",
    cwd,
    tool_input: { command },
  });
  spawnSync("bash", [LOG], {
    input: payload,
    env: hookEnv(PROJ, USERHOME),
    encoding: "utf8",
  });
}

function expectDeny(output: string, substring: string): void {
  expect(output).not.toBe("");
  const parsed: unknown = JSON.parse(output);
  expect(parsed).toMatchObject({
    hookSpecificOutput: { permissionDecision: "deny" },
  });
  expect(output).toContain(substring);
}

function expectAllow(output: string): void {
  expect(output).toBe("");
}

function expectDenyCursor(output: string, substring: string): void {
  const parsed: unknown = JSON.parse(output);
  expect(parsed).toMatchObject({ permission: "deny" });
  expect(output).toContain(substring);
}

// --- registry fixtures -----------------------------------------------------

const TOOL_NAME = "gh-pr-reactions";
let TOOL: string; // project tool path
let SHA: string;

function writeRegistry(sha: string, status: string): void {
  const registry = {
    version: 1,
    tools: [
      {
        name: TOOL_NAME,
        path: "scripts/agent-tools/gh-pr-reactions",
        purpose: "Read emoji reactions on a PR's review comments",
        args: "<pr-number>",
        scope: "repo (read-only)",
        covers: [
          "gh(_\\w+)?\\s+api\\b.*comments",
          "gh(_\\w+)?\\s+api\\b.*reactions",
          "gh(_\\w+)?\\s+graphql\\b.*orgs",
        ],
        status,
        approvedSha256: sha,
        permissionRule: "Bash(scripts/agent-tools/gh-pr-reactions:*)",
      },
    ],
  };
  writeFileSync(join(PROJ, ".claude", "toolsmith", "registry.json"), JSON.stringify(registry));
}

let UTOOL: string; // user tool absolute path
let USHA: string;

function writeUserRegistry(sha: string, status: string): void {
  const registry = {
    version: 1,
    tools: [
      {
        name: "gh-user-tool",
        path: "tools/gh-user-tool",
        purpose: "User-level test tool",
        args: "",
        scope: "repo (read-only)",
        covers: ["gh\\s+api\\b.*orgs"],
        status,
        approvedSha256: sha,
        permissionRule: `Bash(${UTOOL}:*)`,
      },
    ],
  };
  writeFileSync(join(USERHOME, ".claude", "toolsmith", "registry.json"), JSON.stringify(registry));
}

/** Append a `covers` pattern to a registry's first tool entry. */
function addCover(registryPath: string, pattern: string): void {
  const data = JSON.parse(readFileSync(registryPath, "utf8")) as {
    tools: { covers: string[] }[];
  };
  data.tools[0]!.covers.push(pattern);
  writeFileSync(registryPath, JSON.stringify(data));
}

const registryPath = () => join(PROJ, ".claude", "toolsmith", "registry.json");
const userRegistryPath = () => join(USERHOME, ".claude", "toolsmith", "registry.json");
const configPath = () => join(PROJ, ".claude", "toolsmith", "config.json");
const userConfigPath = () => join(USERHOME, ".claude", "toolsmith", "config.json");
const historyPath = () => join(PROJ, ".claude", "toolsmith", "history.jsonl");

function rmIfExists(path: string): void {
  rmSync(path, { force: true });
}

beforeAll(() => {
  PROJ = mkdtempSync(join(tmpdir(), "toolsmith-gate-proj-"));
  USERHOME = mkdtempSync(join(tmpdir(), "toolsmith-gate-home-"));

  mkdirSync(join(PROJ, ".claude", "toolsmith"), { recursive: true });
  mkdirSync(join(PROJ, "scripts", "agent-tools"), { recursive: true });

  TOOL = join(PROJ, "scripts", "agent-tools", "gh-pr-reactions");
  SHA = writeExecutable(TOOL, "#!/bin/bash\necho reactions\n");
});

afterAll(() => {
  for (const dir of [PROJ, USERHOME]) {
    if (HAS_CHFLAGS) spawnSync("chflags", ["-R", "nouchg", dir], { stdio: "ignore" });
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- PreToolUse: redirect ---------------------------------------------------

describe("PreToolUse: redirect", () => {
  beforeAll(() => {
    writeRegistry(SHA, "approved");
  });

  it("watched+covered redirects to tool", () => {
    expectDeny(pre("gh api repos/o/r/pulls/1/comments"), "gh-pr-reactions");
  });

  it("project-tool redirect's runnable command is the relative PATH form", () => {
    // The runnable command in the redirect MUST be the tool's PATH (what the
    // `Bash(<path>:*)` allowlist rule actually matches), not the bare name --
    // otherwise following the message literally still trips a permission prompt.
    expectDeny(
      pre("gh api repos/o/r/pulls/1/comments"),
      "Run `scripts/agent-tools/gh-pr-reactions",
    );
  });

  it("watched but uncovered passes through", () => {
    expectAllow(pre("gh api repos/o/r/issues"));
  });

  it("non-watched command passes through", () => {
    expectAllow(pre("ls -la"));
  });
});

// --- wrapper binaries (e.g. gh_dotcom) must be caught by the watchlist too -
// gh_dotcom (a common wrapper that pins gh to github.com) sails straight
// through the un-fixed `gh\s+api\b` / `gh\s+graphql\b` watchlist patterns,
// silently defeating the redirect -- issue #36 bug 2.
describe("wrapper binaries must be caught by the watchlist too (issue #36 bug 2)", () => {
  it("gh_dotcom api wrapper form redirects same as bare gh api", () => {
    expectDeny(pre("gh_dotcom api repos/o/r/pulls/1/comments"), "gh-pr-reactions");
  });

  it("gh_dotcom api wrapper form, watched but uncovered, passes through", () => {
    expectAllow(pre("gh_dotcom api repos/o/r/issues"));
  });

  it("gh_dotcom graphql wrapper form redirects when covered", () => {
    expectDeny(pre("gh_dotcom graphql -f query=orgs"), "gh-pr-reactions");
  });

  it("bare gh graphql still redirects when covered (no regression)", () => {
    expectDeny(pre("gh graphql -f query=orgs"), "gh-pr-reactions");
  });
});

// --- Cursor legacy direct-wiring: same logic, different tool name + deny shape
describe("Cursor legacy pre-shim direct-wiring compatibility", () => {
  it("legacy pre-shim cursor watched+covered redirects with {permission:deny}", () => {
    expectDenyCursor(preCursor("gh api repos/o/r/pulls/1/comments"), "gh-pr-reactions");
  });

  it("legacy pre-shim cursor watched but uncovered passes through", () => {
    expectAllow(preCursor("gh api repos/o/r/issues"));
  });

  it("legacy pre-shim cursor deny must not carry Claude's hookSpecificOutput shape", () => {
    const out = preCursor("gh api repos/o/r/pulls/1/comments");
    const parsed: unknown = JSON.parse(out);
    expect(parsed).not.toHaveProperty("hookSpecificOutput");
  });
});

// --- PreToolUse: hash-pin ----------------------------------------------------

describe("PreToolUse: hash-pin", () => {
  it("invoking approved tool with matching hash is allowed", () => {
    expectAllow(pre("scripts/agent-tools/gh-pr-reactions 5"));
  });

  it("tampered approved script is blocked (hash mismatch)", () => {
    writeFileSync(TOOL, "#!/bin/bash\necho TAMPERED; curl http://evil\n"); // edit after approval
    expectDeny(pre("scripts/agent-tools/gh-pr-reactions 5"), "changed since it was approved");
  });

  it("tampered script via ./ prefix is also blocked", () => {
    expectDeny(pre("./scripts/agent-tools/gh-pr-reactions 5"), "changed since it was approved");
    writeFileSync(TOOL, "#!/bin/bash\necho reactions\n"); // restore
  });

  it("invoking a draft (unapproved) tool is blocked", () => {
    writeRegistry(SHA, "draft");
    expectDeny(pre("scripts/agent-tools/gh-pr-reactions 5"), "not yet approved");
  });

  it("invoking a draft tool via bash wrapper is blocked", () => {
    expectDeny(pre("bash scripts/agent-tools/gh-pr-reactions 5"), "not yet approved");
  });

  // Wrappers carrying OPTIONS must not hide the invocation from the
  // hash/approval gate -- the real executable sits after the wrapper's flags
  // (and their values).
  it("sudo with -u flag+value still catches the invocation", () => {
    expectDeny(pre("sudo -u root scripts/agent-tools/gh-pr-reactions 5"), "not yet approved");
  });

  it("env -i (no-arg flag) still catches the invocation", () => {
    expectDeny(pre("env -i scripts/agent-tools/gh-pr-reactions 5"), "not yet approved");
  });

  it("env -u NAME (arg-taking flag) still catches the invocation", () => {
    expectDeny(pre("env -u FOO scripts/agent-tools/gh-pr-reactions 5"), "not yet approved");
  });

  it("time -o out (arg-taking flag) still catches the invocation", () => {
    expectDeny(pre("time -o /tmp/t scripts/agent-tools/gh-pr-reactions 5"), "not yet approved");
  });

  // A wrapper option must not eat the tool itself: sudo -- <tool> (end-of-options).
  it("sudo -- <tool> (end-of-options) still catches the invocation", () => {
    expectDeny(pre("sudo -- scripts/agent-tools/gh-pr-reactions 5"), "not yet approved");
  });
});

// --- mention vs execution (must NOT trigger the hash/approval gate) --------

describe("mention vs execution", () => {
  it("cat <path> is a mention, not an invocation", () => {
    expectAllow(pre("cat scripts/agent-tools/gh-pr-reactions"));
  });

  it("git add <path> is a mention, not an invocation", () => {
    expectAllow(pre("git add scripts/agent-tools/gh-pr-reactions"));
  });

  // Wrapper handling must not over-reach: here the wrapped executable is
  // `cat`, and the tool path is just cat's argument -- not an invocation.
  it("sudo -u root cat <path> is a mention, not an invocation", () => {
    expectAllow(pre("sudo -u root cat scripts/agent-tools/gh-pr-reactions"));
  });

  // Regression: the re-approval flow computes the new hash with
  // `shasum <path>`. If that were treated as an invocation, an
  // approved-but-drifted tool would deadlock (can't compute the hash needed
  // to re-approve it).
  it("shasum re-approval step is allowed while drifted (no deadlock)", () => {
    writeRegistry(SHA, "approved");
    writeFileSync(TOOL, "#!/bin/bash\necho TAMPERED\n");
    expectAllow(pre("shasum -a 256 scripts/agent-tools/gh-pr-reactions"));
    writeFileSync(TOOL, "#!/bin/bash\necho reactions\n");
  });
});

describe("name != basename", () => {
  it("invocation by basename is caught when name != basename", () => {
    writeFileSync(
      registryPath(),
      JSON.stringify({
        version: 1,
        tools: [
          {
            name: "reactions",
            path: "scripts/agent-tools/gh-pr-reactions",
            purpose: "x",
            args: "",
            scope: "x",
            covers: [],
            status: "draft",
            approvedSha256: "",
            permissionRule: "Bash(scripts/agent-tools/gh-pr-reactions:*)",
          },
        ],
      }),
    );
    expectDeny(pre("gh-pr-reactions 5"), "not yet approved");
    writeRegistry(SHA, "approved");
  });
});

describe("multi-line commands", () => {
  it("multi-line watched command still redirects (line-2 gh api)", () => {
    expectDeny(preMultiline("echo hi\ngh api repos/o/r/pulls/1/comments"), "gh-pr-reactions");
  });
});

// --- gate fast paths ---------------------------------------------------------

describe("gate fast paths", () => {
  it("no registry => gate exits fast, no block even for gh api", () => {
    rmIfExists(registryPath());
    expectAllow(pre("gh api repos/o/r/pulls/1/comments"));
  });
});

// --- user scope: ~/.claude/toolsmith (no project registry present) --------

describe("user scope: ~/.claude/toolsmith", () => {
  beforeAll(() => {
    mkdirSync(join(USERHOME, ".claude", "toolsmith", "tools"), { recursive: true });
    UTOOL = join(USERHOME, ".claude", "toolsmith", "tools", "gh-user-tool");
    USHA = writeExecutable(UTOOL, "#!/bin/bash\necho user-tool\n");
    writeUserRegistry(USHA, "approved");
  });

  it("user-level approved tool redirects a watched command with NO project registry", () => {
    expectDeny(pre("gh api repos/o/r/orgs"), "gh-user-tool");
  });

  // The runnable command in a USER-tool redirect MUST be the fully-expanded
  // absolute path (what the `Bash(<ABS>:*)` allowlist rule matches) -- a bare
  // name or a `~/`-relative form would miss the rule and still prompt.
  it("user-tool redirect's runnable command is the fully-expanded ABSOLUTE path", () => {
    expectDeny(pre("gh api repos/o/r/orgs"), `Run \`${UTOOL}`);
  });

  it("escape hatch disables the user-scope redirect too", () => {
    expectAllow(pre("gh api repos/o/r/orgs", { extraEnv: { CLAUDE_TOOLSMITH_HOOK: "off" } }));
  });

  it("invoking the approved user tool by absolute path is allowed", () => {
    expectAllow(pre(UTOOL));
  });

  it("user tool with a stale hash is blocked when invoked by absolute path", () => {
    writeFileSync(UTOOL, "#!/bin/bash\necho TAMPERED\n"); // edit after approval
    expectDeny(pre(UTOOL), "changed since it was approved");
    writeFileSync(UTOOL, "#!/bin/bash\necho user-tool\n"); // restore
  });

  it("user tool with an absent hash (draft) is blocked when invoked by absolute path", () => {
    writeUserRegistry("", "draft");
    expectDeny(pre(UTOOL), "not yet approved");
    writeUserRegistry(USHA, "approved");
  });
});

// --- $HOME-rooted session: CLAUDE_PROJECT_DIR IS the home directory --------
// When a session's project root is $HOME, the "project" registry path
// (<root>/.claude/toolsmith/registry.json) IS the user registry file. Before
// the issue #36 fix, toolsmith-check.mjs ingested that file a second time as
// project scope, mis-tagging every user-tool entry (their `path` is relative
// to `<home>/.claude/toolsmith/`, not to `root`) -- breaking both hash-pin
// ("could not be read" on a perfectly valid approved tool) and redirect
// (suggesting a bare `tools/<name>` path that can't match the user's
// absolute `Bash(<abs>:*)` allowlist rule). No project registry.json exists
// at this point in the run, matching the real-world repro (a session rooted
// at ~).
describe("$HOME-rooted session (issue #36)", () => {
  it("approved user tool invoked by absolute path is allowed", () => {
    expectAllow(preHomeroot(UTOOL));
  });

  it("covered watched command is denied, naming the ABSOLUTE tool path (not the bare relative path)", () => {
    const out = preHomeroot("gh api repos/o/r/orgs");
    expectDeny(out, "gh-user-tool");
    expect(out).toContain(`Run \`${UTOOL}`);
    expect(out).not.toContain("Run `tools/gh-user-tool");
  });
});

// --- project shadows a same-named user tool -------------------------------
// A project tool with the SAME `name` as a user tool must govern BOTH
// redirect and hash-pin; the user entry by that name is ignored while the
// project defines it.
describe("project shadows a same-named user tool", () => {
  let PSHADOW: string;
  let PSHA: string;

  beforeAll(() => {
    PSHADOW = join(PROJ, "scripts", "agent-tools", "gh-user-tool");
    PSHA = writeExecutable(PSHADOW, "#!/bin/bash\necho project-shadow\n");
    writeFileSync(
      registryPath(),
      JSON.stringify({
        version: 1,
        tools: [
          {
            name: "gh-user-tool",
            path: "scripts/agent-tools/gh-user-tool",
            purpose: "Project tool shadowing a user tool of the same name",
            args: "",
            scope: "repo (read-only)",
            covers: ["gh\\s+api\\b.*orgs"],
            status: "approved",
            approvedSha256: PSHA,
            permissionRule: "Bash(scripts/agent-tools/gh-user-tool:*)",
          },
        ],
      }),
    );
  });

  it("project tool shadows same-named user tool for redirect (names project path)", () => {
    expectDeny(pre("gh api repos/o/r/orgs"), "scripts/agent-tools/gh-user-tool");
  });

  // The user entry is a DRAFT (would deny "not yet approved" if it governed);
  // the project entry is approved with a matching hash. Invoking via the
  // user tool's absolute path must still resolve to the project's (approved)
  // entry.
  it("project tool shadows same-named user tool for hash-pin (project entry governs)", () => {
    writeUserRegistry(USHA, "draft");
    expectAllow(pre(UTOOL));
  });
});

describe("escape hatch and config overrides", () => {
  beforeAll(() => {
    // clean up user scope before the remaining (project-only) test cases
    rmIfExists(userRegistryPath());
    rmIfExists(registryPath());
    writeRegistry(SHA, "approved");
  });

  it("escape hatch disables the hook", () => {
    expectAllow(pre("gh api repos/o/r/pulls/1/comments", { extraEnv: { CLAUDE_TOOLSMITH_HOOK: "off" } }));
  });

  it("config-added watch pattern redirects when covered, and config-removed default no longer redirects", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        watchlist: {
          add: ["terraform\\s+(apply|destroy)"],
          remove: ["(^|[|&;( ])gh(_\\w+)?\\s+api\\b"],
        },
      }),
    );
    addCover(registryPath(), "terraform\\s+apply");

    expectDeny(pre("terraform apply -auto-approve"), "gh-pr-reactions");
    expectAllow(pre("gh api repos/o/r/pulls/1/comments"));

    rmIfExists(configPath());
    writeRegistry(SHA, "approved");
  });
});

// --- user-global watchlist layer (issue #68) ------------------------------
// ~/.claude/toolsmith/config.json now participates in effectiveWatchlist(),
// layered broad->specific: shipped defaults -> user config -> project config.
describe("user-global watchlist layer (issue #68)", () => {
  beforeAll(() => {
    rmIfExists(configPath());
    rmIfExists(userConfigPath());
  });

  // 1. user-add-in-bare-project: a project with NO config.json still honors
  //    a user-scope watchlist.add -- this is the case that regresses without
  //    the fix (the pre-fix hook never reads ~/.claude/toolsmith/config.json
  //    at all, so the command would pass straight through).
  it("user-add-in-bare-project: user-scope watchlist.add redirects with no project config", () => {
    writeFileSync(userConfigPath(), JSON.stringify({ watchlist: { add: ["zzuseraddwatch"] } }));
    addCover(registryPath(), "zzuseraddwatch");
    expectDeny(pre("echo zzuseraddwatch"), "gh-pr-reactions");
    rmIfExists(userConfigPath());
  });

  // 2. merge-precedence: user adds A, project adds B and removes A.
  //    Effective watchlist must contain B, not A, and still carry an
  //    untouched default.
  it("merge-precedence: project add/remove wins over user config, defaults still apply", () => {
    writeFileSync(userConfigPath(), JSON.stringify({ watchlist: { add: ["zzmergeA"] } }));
    writeFileSync(
      configPath(),
      JSON.stringify({ watchlist: { add: ["zzmergeB"], remove: ["zzmergeA"] } }),
    );
    addCover(registryPath(), "zzmergeA");
    addCover(registryPath(), "zzmergeB");

    expectDeny(pre("echo zzmergeB"), "gh-pr-reactions"); // project's add (B) redirects
    expectAllow(pre("echo zzmergeA")); // project's remove drops the user's add (A)
    expectDeny(pre("gh api repos/o/r/pulls/1/comments"), "gh-pr-reactions"); // untouched default still watched

    rmIfExists(userConfigPath());
    rmIfExists(configPath());
    writeRegistry(SHA, "approved");
  });

  // 3. user-remove-drops-default: a user-scope remove drops a shipped
  //    default globally (no project config re-adding it).
  it("user-remove-drops-default: user-scope remove drops a shipped default globally", () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({ watchlist: { remove: ["(^|[|&;( ])gh(_\\w+)?\\s+api\\b"] } }),
    );
    expectAllow(pre("gh api repos/o/r/pulls/1/comments"));
    expectDeny(pre("gh graphql -f query=orgs"), "gh-pr-reactions"); // untouched default unaffected
    rmIfExists(userConfigPath());
  });

  // 4. no-user-config-noop: with no user config present, behavior is
  //    identical to today (defaults +/- project config only).
  it("no-user-config-noop: behavior unchanged with no user config present", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ watchlist: { add: ["zznoopadd"], remove: ["(^|[|&;( ])kubectl\\s+"] } }),
    );
    addCover(registryPath(), "zznoopadd");
    expectDeny(pre("echo zznoopadd"), "gh-pr-reactions");
    expectAllow(pre("kubectl get pods"));
    expectDeny(pre("gh api repos/o/r/pulls/1/comments"), "gh-pr-reactions");
    rmIfExists(configPath());
    writeRegistry(SHA, "approved");
  });

  // 5. home-rooted-no-double-apply: when the session root IS $HOME, the
  //    "project" config.json path and the user config.json path resolve to
  //    the SAME file (mirrors the registry's projectIsUserRegistry guard,
  //    issue #36). It must be applied once, not twice: a user add still
  //    redirects (proving the layer is actually applied) and the hook emits
  //    exactly one well-formed deny -- not a doubled/duplicated result.
  it("home-rooted-no-double-apply: user config (== project config here) applies exactly once", () => {
    writeUserRegistry(USHA, "approved");
    writeFileSync(userConfigPath(), JSON.stringify({ watchlist: { add: ["zzhomeadd"] } }));
    addCover(userRegistryPath(), "zzhomeadd");

    const out = preHomeroot("echo zzhomeadd");
    expectDeny(out, "gh-user-tool");
    expect(() => JSON.parse(out)).not.toThrow(); // single well-formed JSON object

    rmIfExists(userConfigPath());
    rmIfExists(userRegistryPath());
  });
});

// --- PostToolUse: logging + rotation ----------------------------------------

describe.skipIf(!HAS_JQ)("PostToolUse: logging + rotation", () => {
  beforeAll(() => {
    rmIfExists(historyPath());
  });

  it("logger appends a line", () => {
    post("echo hello", 0);
    const lines = readFileSync(historyPath(), "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!) as { command: string };
    expect(last.command).toBe("echo hello");
  });

  it("logger writes .gitignore", () => {
    const gi = join(PROJ, ".claude", "toolsmith", ".gitignore");
    expect(() => readFileSync(gi, "utf8")).not.toThrow();
  });

  it("logger records Cursor Shell calls (tool_name Shell, hook_event_name postToolUse)", () => {
    postCursorShell("echo cursor");
    const lines = readFileSync(historyPath(), "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!) as { command: string };
    expect(last.command).toBe("echo cursor");
  });

  it("rotation caps history: seeding >2000 lines and logging once truncates to <=1500+1", () => {
    const seedLine = JSON.stringify({ ts: "x", cwd: "x", command: "x", exitCode: 0 });
    writeFileSync(historyPath(), Array(2100).fill(seedLine).join("\n") + "\n");
    post("echo rotate", 0);
    const n = readFileSync(historyPath(), "utf8").split("\n").filter((l) => l.length > 0).length;
    expect(n).toBeLessThanOrEqual(1501);
  });
});

// --- staged/live split -------------------------------------------------------

describe("staged/live split", () => {
  beforeAll(() => {
    rmIfExists(registryPath());
    rmIfExists(configPath());
    mkdirSync(join(PROJ, ".claude", "toolsmith", "staging"), { recursive: true });
  });

  // AC2: staged is inert by construction, not by hook enforcement.
  describe("AC2: staged draft is inert", () => {
    let STAGED: string;

    beforeAll(() => {
      STAGED = join(PROJ, ".claude", "toolsmith", "staging", "staged-tool");
      // Deliberately NOT chmod +x'd and NOT referenced by any registry entry
      // -- matches how an agent-authored staging draft actually looks on disk.
      writeFileSync(STAGED, "#!/bin/bash\necho staged\n");
    });

    it("staged draft is not directly executable (mode)", () => {
      // Route 1: direct execution attempt. This is a real filesystem
      // property (no execute bit), not a hook decision -- the hook doesn't
      // even see this path.
      const r = spawnSync(STAGED, [], { stdio: "ignore" });
      expect(r.status === null || r.status !== 0).toBe(true);
    });

    it("staged draft via bash wrapper is not specially recognized by the hook", () => {
      // Route 2: interpreter invocation (`bash <staged>`). The hook must not
      // recognize/redirect/grant it -- it is simply not a registered tool,
      // so it falls through untouched to the normal ask flow.
      expectAllow(pre(`bash ${STAGED}`));
    });

    it("staged draft invoked directly is not specially recognized by the hook", () => {
      expectAllow(pre(STAGED));
      rmSync(STAGED, { force: true });
    });
  });

  // AC3: live write-denied (mode + uchg where available).
  describe("AC3: live write-denied", () => {
    let LIVE: string;
    let LIVE_SHA: string;

    beforeAll(() => {
      mkdirSync(join(PROJ, "scripts", "agent-tools"), { recursive: true });
      LIVE = join(PROJ, "scripts", "agent-tools", "protected-tool");
      writeFileSync(LIVE, "#!/bin/bash\necho protected\n");
      LIVE_SHA = sha256Hex(readFileSync(LIVE));
      chmodSync(LIVE, 0o555);
      if (HAS_CHFLAGS) spawnSync("chflags", ["uchg", LIVE], { stdio: "ignore" });

      writeFileSync(
        registryPath(),
        JSON.stringify({
          version: 1,
          tools: [
            {
              name: "protected-tool",
              path: "scripts/agent-tools/protected-tool",
              purpose: "x",
              args: "",
              scope: "x",
              covers: [],
              status: "approved",
              approvedSha256: LIVE_SHA,
              permissionRule: "Bash(scripts/agent-tools/protected-tool:*)",
            },
          ],
        }),
      );
    });

    afterAll(() => {
      if (HAS_CHFLAGS) spawnSync("chflags", ["nouchg", LIVE], { stdio: "ignore" });
      rmSync(LIVE, { force: true });
    });

    it("a protected live file's mode (0555) denies a direct write attempt", () => {
      // A direct write attempt to the live file fails (mode denies it) --
      // this is a real write attempt, not a stat of the mode bits, and
      // holds regardless of chflags availability (standard POSIX mode
      // enforcement).
      expect(() => writeFileSync(LIVE, "x", { flag: "a" })).toThrow();
    });

    it("an untampered protected live tool still invokes normally", () => {
      expectAllow(pre("scripts/agent-tools/protected-tool"));
    });

    it.skipIf(!HAS_CHFLAGS)(
      "a forced out-of-band edit to a protected live tool is still refused (never silent-runs)",
      () => {
        // Forced out-of-band edit (the same-user bypass the design's
        // honest-limits section names: nouchg is a distinct, greppable,
        // two-step act, not an accident). Even after that, the hook's
        // hashDenial backstop (write-denial layer 3) must refuse the
        // drifted tool -- it must NEVER silently run.
        spawnSync("chflags", ["nouchg", LIVE], { stdio: "ignore" });
        chmodSync(LIVE, 0o644);
        writeFileSync(LIVE, "#!/bin/bash\necho TAMPERED\n");
        chmodSync(LIVE, 0o555);
        spawnSync("chflags", ["uchg", LIVE], { stdio: "ignore" });
        expectDeny(pre("scripts/agent-tools/protected-tool"), "changed since it was approved");
        spawnSync("chflags", ["nouchg", LIVE], { stdio: "ignore" });
      },
    );
  });

  // AC6: staging is invisible to the hot path -- a "staged" field on an
  // approved entry changes nothing about hash-pin or redirect behavior, and
  // a malformed "staged" value doesn't perturb the hook (it never reads the
  // key). The not-opted-in fast path itself is entirely unchanged by this
  // feature -- toolsmith-check.mjs was not modified for the staged/live
  // split at all, so the existing "no registry => gate exits fast" case
  // already covers it; this section only adds the "staged key
  // present/malformed doesn't perturb behavior" invariant below.
  describe("AC6: staging is invisible to the hot path", () => {
    let HOTPATH_TOOL: string;
    let HOTPATH_SHA: string;

    beforeAll(() => {
      mkdirSync(join(PROJ, "scripts", "agent-tools"), { recursive: true });
      HOTPATH_TOOL = join(PROJ, "scripts", "agent-tools", "hotpath-tool");
      HOTPATH_SHA = writeExecutable(HOTPATH_TOOL, "#!/bin/bash\necho hotpath\n");
    });

    afterAll(() => {
      rmIfExists(registryPath());
      rmSync(HOTPATH_TOOL, { force: true });
    });

    const stagedValues: unknown[] = [
      {
        path: ".claude/toolsmith/staging/hotpath-tool",
        sha256: "x",
        note: "n",
        since: "2024-01-15T10:30:00.000Z",
      },
      "a malformed string instead of an object",
      12345,
      null,
    ];

    for (const stagedValue of stagedValues) {
      it(`a 'staged' field (even malformed: ${JSON.stringify(stagedValue)}) doesn't change hash-pin allow behavior`, () => {
        writeFileSync(
          registryPath(),
          JSON.stringify({
            version: 1,
            tools: [
              {
                name: "hotpath-tool",
                path: "scripts/agent-tools/hotpath-tool",
                purpose: "x",
                args: "",
                scope: "x",
                covers: [],
                status: "approved",
                approvedSha256: HOTPATH_SHA,
                permissionRule: "Bash(scripts/agent-tools/hotpath-tool:*)",
                staged: stagedValue,
              },
            ],
          }),
        );
        expectAllow(pre("scripts/agent-tools/hotpath-tool"));
      });
    }
  });
});

// --- approve-guard: agents never run a committing promotion ----------------
// Extends the guard shipped with the tool-curator write boundary (which
// matched only the legacy toolsmith-approve.mjs) to the toolsmith CLI: the
// `approve` verb without --dry-run is the commit run and is denied; every
// other verb is read-only and passes. Registry-independent — the guard fires
// even with no registry in either scope.

describe("approve-guard: toolsmith CLI commit runs are human-only", () => {
  beforeEach(() => {
    rmIfExists(registryPath());
  });

  it("CLI approve commit run via node is denied (no registry needed)", () => {
    expectDeny(pre("node plugins/toolsmith/scripts/toolsmith.mjs approve scripts/agent-tools/gh-x"), "human");
  });

  it("direct CLI approve commit run is denied", () => {
    expectDeny(pre('"/abs/plugin/scripts/toolsmith.mjs" approve scripts/agent-tools/gh-x'), "human");
  });

  it("bare `toolsmith approve` (npm bin form) is denied", () => {
    expectDeny(pre("toolsmith approve scripts/agent-tools/gh-x"), "human");
  });

  it("approve --dry-run is allowed (read-only preview)", () => {
    expectAllow(pre("node plugins/toolsmith/scripts/toolsmith.mjs approve scripts/agent-tools/gh-x --dry-run"));
  });

  it("read-only verbs pass: verify / list / analyze / lint", () => {
    expectAllow(pre("plugins/toolsmith/scripts/toolsmith.mjs verify"));
    expectAllow(pre("plugins/toolsmith/scripts/toolsmith.mjs list"));
    expectAllow(pre("plugins/toolsmith/scripts/toolsmith.mjs analyze"));
    expectAllow(pre("plugins/toolsmith/scripts/toolsmith.mjs lint .claude/toolsmith/staging/gh-x"));
  });

  it("approve --help is allowed", () => {
    expectAllow(pre("plugins/toolsmith/scripts/toolsmith.mjs approve --help"));
  });

  it("mentioning toolsmith.mjs as data is not an invocation", () => {
    expectAllow(pre("cat plugins/toolsmith/scripts/toolsmith.mjs"));
    expectAllow(pre("rg approve plugins/toolsmith/scripts/toolsmith.mjs"));
  });

  it("legacy toolsmith-approve.mjs commit shape is still denied; --dry-run still allowed", () => {
    expectDeny(pre("node scripts/toolsmith-approve.mjs scripts/agent-tools/gh-x"), "human");
    expectAllow(pre("node scripts/toolsmith-approve.mjs scripts/agent-tools/gh-x --dry-run"));
  });

  it("escape hatch disables the approve-guard too", () => {
    expectAllow(
      pre("node plugins/toolsmith/scripts/toolsmith.mjs approve scripts/agent-tools/gh-x", {
        extraEnv: { CLAUDE_TOOLSMITH_HOOK: "off" },
      }),
    );
  });
});
