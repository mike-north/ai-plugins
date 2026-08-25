/**
 * toolsmith — the deterministic backbone for repeatable toolsmith operations
 * (docs/toolsmith/cli-surface.md). Verbs: approve (the one trust boundary),
 * revoke (its symmetric demotion/retirement counterpart), verify, lint (the
 * proposal gate), list, analyze. Authoring (`new`/`modify`) is deliberately
 * NOT a verb — drafting is agent file-editing against the skill's skeleton;
 * only re-approval after an edit is privileged.
 *
 * This file is bundled (esbuild) into the committed, dependency-free
 * executable at plugins/toolsmith/scripts/toolsmith.mjs so marketplace
 * installs need no build step, and into this package's dist/toolsmith.mjs bin.
 * Source of truth: packages/toolsmith/src/.
 */
import { runApprove } from "./commands/approve.js";
import { runRevoke } from "./commands/revoke.js";
import { runVerify } from "./commands/verify.js";
import { runList } from "./commands/list.js";
import { runAnalyze } from "./commands/analyze.js";
import { runLint } from "./commands/lint.js";

/** Injected at build time from the plugin manifest (never hand-typed — see
 * scripts/build-toolsmith-cli.mjs and ~/.claude/rules/no-hardcoded-versions.md). */
declare const __TOOLSMITH_VERSION__: string;

const VERSION: string = typeof __TOOLSMITH_VERSION__ === "string" ? __TOOLSMITH_VERSION__ : "0.0.0";

const HELP = `toolsmith ${VERSION} — purpose-built-tool lifecycle for the toolsmith plugin

Usage:
  toolsmith approve <path> [--user] [--dry-run]   Promote a staged draft to live (see below)
  toolsmith revoke <path> [--user] [--dry-run]    Retire a live tool — the symmetric inverse of approve
  toolsmith verify [<path>] [--user]              Read-only integrity check of live pins
  toolsmith lint <file>                           Proposal gate: lint a staged draft
  toolsmith list                                  Registry inventory + drift, both scopes (markdown)
  toolsmith analyze                               Mine .claude/toolsmith/history.jsonl (markdown)
  toolsmith --help | --version

approve is the one trust boundary and its commit run is a HUMAN act: run it
in your own terminal after reading the --dry-run review surface. revoke's
commit run is the same human act, in reverse. Agents may only run --dry-run /
verify / lint / list / analyze.

Run \`toolsmith <verb> --help\` for verb details.
`;

const APPROVE_HELP = `toolsmith approve — the staged/live promotion handshake (write side)

You are the human in this handshake. An agent authored a draft under the
staging namespace; nothing about it is executable or granted until YOU
promote it here, in your own terminal. Agents are denied the commit run by
the toolsmith PreToolUse hook — only --dry-run passes for them.

Usage:
  toolsmith approve <path>                Promote: place the staged draft as live, pin + grant
  toolsmith approve <path> --dry-run      Preview the promotion — read the review surface; no writes
  toolsmith approve <name-or-path> --user [--dry-run]
                                          Same, for a user-scope (global) tool

What to do:
  1. Run with --dry-run and READ the review surface — for a revision it is a
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
through staging — live never accepts a direct edit.
`;

const REVOKE_HELP = `toolsmith revoke — retire a live tool (the symmetric inverse of approve)

You are the human in this handshake, same as approve. Agents are denied the
commit run by the toolsmith PreToolUse hook — only --dry-run passes for them.

Usage:
  toolsmith revoke <path>                 Retire: remove the rule, mark retired, remove the live file
  toolsmith revoke <path> --dry-run       Preview the revoke — no writes
  toolsmith revoke <name-or-path> --user [--dry-run]
                                          Same, for a user-scope (global) tool

What the commit run does (deterministic, idempotent, in this order — the
capability is always removed before the artifact):
  1. removes the tool's Bash(...) rule from the scope's settings.json
  2. marks the registry entry status: "retired" (this is also the
     de-registration — steering only honors "approved" entries)
  3. clears the BSD immutable flag where available and removes the live file

The registry entry itself is KEPT, not deleted, so its history (name, pinned
hash, the rule it held) stays auditable.

<path> is a project-relative path naming a registry entry in
.claude/toolsmith/registry.json. With --user, pass a bare tool name or
"tools/<name>", resolved against ~/.claude/toolsmith/.

Fail-closed and idempotent: revoking an already-retired or unknown tool is a
clean no-op, not an error; a kill mid-revoke never leaves a stale grant, and
re-running converges.
`;

const VERIFY_HELP = `toolsmith verify — read-only integrity check of LIVE pins

Usage:
  toolsmith verify [--user] [<path>]

Prints one line per registry tool, prefixed with its status:
  OK       file present and sha256 matches the pinned approvedSha256
  DRIFTED  hash differs from the pinned value (the hook blocks invocation)
  MISSING  the file no longer exists (or its registry path is invalid)
  draft    not yet approved
  retired  revoked via \`toolsmith revoke\` — no live file, no grant

Exit 0 when everything is OK/draft/retired; exit 1 if anything DRIFTED or MISSING.
`;

const LINT_HELP = `toolsmith lint — the proposal gate for staged drafts

Usage:
  toolsmith lint <file>

Runs the same gate \`toolsmith approve\` enforces fail-closed: bash syntax
(bash -n), shellcheck error-severity findings (when installed), and draft
sanity (non-empty, text). Warnings (shebang, shellcheck warnings,
interactivity, secret-bearing flags) don't block; errors do. The forge rule
pack (docs/toolsmith/lint-rule-concepts.md) is pending eslint-sh and is
reported as such — never silently implied to have run.

Exit 0 on pass (warnings allowed), 1 on errors.
`;

const LIST_HELP = `toolsmith list — deterministic registry inventory (relay-markdown)

Usage:
  toolsmith list

Reads both registries (.claude/toolsmith/registry.json and
~/.claude/toolsmith/registry.json), verifies every live pin, and renders
per-scope tables plus pending staged drafts with a three-way drift state
(pending / live-drifted-too / staged-missing / new). A retired tool (revoked
via \`toolsmith revoke\`) is reported distinctly from draft — it was live once
and no longer is. A registry that exists but won't parse is reported as a
PARSE ERROR for that scope — the hook fails open on malformed JSON, so the
redirect/tamper block is disarmed until fixed.

Exit 0 when clean; exit 1 if anything is DRIFTED/MISSING or a registry
fails to parse.
`;

const ANALYZE_HELP = `toolsmith analyze — deterministic mining of the Bash history log

Usage:
  toolsmith analyze

Reads .claude/toolsmith/history.jsonl, clusters commands by normalized shape,
counts frequency/failures, and classifies each cluster against the effective
watchlist and approved tools' covers patterns. Output is relay-markdown of
FACTS only — the agent applies the authoring-checklist rubric on top.

The history log can contain inline secrets; every emitted example is
normalized and secret-redacted, and the raw log should never leave the
machine.
`;

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.includes("--version") || argv[0] === "version") {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }

  const verb = argv[0];
  const rest = argv.slice(1);
  const wantsHelp = argv.includes("--help") || argv.includes("-h");

  if (!verb || (wantsHelp && !verb.match(/^(approve|revoke|verify|lint|list|analyze)$/))) {
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
    case "revoke": {
      if (wantsHelp) {
        process.stdout.write(REVOKE_HELP);
        process.exit(0);
      }
      const userScope = rest.includes("--user");
      const dryRun = rest.includes("--dry-run");
      const pathArgs = rest.filter((a) => a !== "--user" && a !== "--dry-run");
      if (pathArgs.length !== 1 || !pathArgs[0]) {
        process.stderr.write("Error: expected exactly one <path> argument.\n\n" + REVOKE_HELP);
        process.exit(1);
      }
      process.exit(runRevoke({ rawPath: pathArgs[0], commit: !dryRun, userScope }));
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
      process.stderr.write(`Error: unknown verb "${verb}".\n\n` + HELP);
      process.exit(1);
    }
  }
}

main();
