# Authoring a purpose-built tool

A toolsmith script is the **narrow slice** where an otherwise-gated broad
command is safe. Its whole value is that a human can proofread it once and
allowlist it forever. Design for that.

## The rubric (from github-fleet-tools)

Build a script only if it is at least one of:

1. **Compound** — collapses several calls (an `gh api | jq | grep` pipeline)
   into one token-efficient result.
2. **Missing** — the porcelain has no verb for it (API-only operation).
3. **Guarded** — enforces a precondition the raw command won't (refuses
   outside an allowed repo, read-only, etc.).
4. **Permission-scopable** — a bounded operation that can't be cleanly
   allowlisted off the broader command, so it earns its own name.

If a script satisfies none of these, don't build it — use the native command.

## Authoring standard

- **One operation per tool.** No subcommand dispatch that reintroduces breadth.
- **No arbitrary-API escape hatch.** The script must not accept a
  caller-supplied URL/path/query that turns it back into `gh api`. Bake the
  endpoint in; take only narrow, validated arguments (a PR number, not a path).
- **Scope is baked in, not passed in.** Hardcode the repo/org allowlist,
  read-only method, region, etc. Validate every argument; reject anything
  outside the intended shape with a clear error and non-zero exit.
- **Stable bare name.** Install/reference it by a stable name (e.g.
  `scripts/agent-tools/<name>`) so the allowlist entry `Bash(<path>:*)`
  doesn't drift with paths or versions.
- **`--help` and meaningful exit codes.** Make it self-describing and scriptable.
- **Fail closed.** On any validation failure, exit non-zero and print why.

## Where it lives: project vs. user (global)

- **Project scope** (repo-specific, committed, reviewed in PRs): the script
  lives at `scripts/agent-tools/<name>`, the draft entry goes in
  `.claude/toolsmith/registry.json`.
- **User/global scope** (personal, reused across every project, not
  committed): the script lives at `~/.claude/toolsmith/tools/<name>`, the
  draft entry goes in `~/.claude/toolsmith/registry.json`. Build here when
  you'd otherwise be re-authoring the same tool in every repo.

## Lifecycle

1. Write the script under `scripts/agent-tools/<name>` (project) or
   `~/.claude/toolsmith/tools/<name>` (user/global) and add a `draft` entry
   to the matching registry (see `registry-schema.md`).
2. Ask the user to **proofread the exact contents**.
3. Run `/toolsmith:approve <path>` (project) or `/toolsmith:approve <name>`
   (user/global — this runs `--user` under the hood) — it shows the script +
   the precise permission rule (via a preview run of
   `scripts/toolsmith-approve.mjs`), and on the user's confirmation runs
   `scripts/toolsmith-approve.mjs --commit` (add `--user` for a global tool),
   which pins the sha256, flips `status` to `approved`, and adds
   `Bash(<path>:*)` (project) or `Bash(<absolute-path>:*)` (user/global) to
   the corresponding `settings.json`.
4. Any later edit changes the sha256, so the hook blocks the tool until it is
   re-approved. Re-run `/toolsmith:approve` (with `--user` again, for a
   global tool) after re-review.

## Worked example

The agent needs emoji reactions on a PR's review comments — no `gh` porcelain
exists (Missing), and it's several GraphQL/REST calls (Compound). A
`gh-pr-reactions <pr-number>` script that hardcodes the repo, takes only a PR
number, and does read-only GETs is the narrow, allowlistable slice. Raw
`gh api` stays gated; this one bounded read does not.
