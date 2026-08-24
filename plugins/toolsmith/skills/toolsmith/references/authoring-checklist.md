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

Every tool has a **live** location (its registered `path`, where it actually
runs from) and a **staging** location (where the agent authors it — see
docs/toolsmith/staged-live-split.md). You always write to staging; only
`/toolsmith:approve` ever places bytes at the live path.

- **Project scope** (repo-specific, committed, reviewed in PRs): the live
  script will be `scripts/agent-tools/<name>`; author the draft at
  `.claude/toolsmith/staging/<name>` and add a `draft` entry (with a `staged`
  field pointing at that draft) to `.claude/toolsmith/registry.json`.
- **User/global scope** (personal, reused across every project, not
  committed): the live script will be `~/.claude/toolsmith/tools/<name>`;
  author the draft at `~/.claude/toolsmith/staging/<name>` and add a `draft`
  entry to `~/.claude/toolsmith/registry.json`. Build here when you'd
  otherwise be re-authoring the same tool in every repo.

**Never write directly at the live path.** Nothing here is enforced against
you doing so by accident-proofing alone (see the design doc's honest-limits
section on write denial) — but the workflow, and the harness's own deny
rules where configured, both assume every write lands in staging first.

## Lifecycle

1. Write the script under `.claude/toolsmith/staging/<name>` (project) or
   `~/.claude/toolsmith/staging/<name>` (user/global). Add a `draft` entry to
   the matching registry declaring the eventual live `path`, with a `staged`
   field pointing at the draft (`path`, a one-line `note`, `since` — see
   `registry-schema.md`). Iterate here freely: nothing here is executable or
   registered with steering, and editing it never disturbs a live version of
   the same tool if one already exists (no lockout).
2. Ask the user to **proofread the exact contents** of the staged draft.
3. Run `/toolsmith:approve <path>` (project) or `/toolsmith:approve <name>`
   (user/global — this runs `--user` under the hood) — it shows the review
   surface (a diff against current live for a revision, full text for a new
   tool) and the precise permission rule (via a `--dry-run` preview of
   `scripts/toolsmith.mjs approve --dry-run`), then hands the human the
   bare `scripts/toolsmith.mjs approve` command to run themselves (add `--user` for a global
   tool). This promotes the staged bytes to the live path (atomically), sets
   the live file to `0555` + the BSD immutable flag where available, pins the
   sha256 recomputed from the placed bytes, flips `status` to `approved`,
   clears the entry's `staged` field, removes the staging file, and adds
   `Bash(<path>:*)` (project) or `Bash(<absolute-path>:*)` (user/global) to
   the corresponding `settings.json`.
4. To change an already-approved tool, author the revision in staging again
   (same draft location) and repeat from step 2 — the previous live version
   keeps running the whole time the revision is pending. Any later edit to
   the *live* file's bytes (which shouldn't happen outside promotion) changes
   the sha256, so the hook blocks the tool until it is re-approved.

## Worked example

The agent needs emoji reactions on a PR's review comments — no `gh` porcelain
exists (Missing), and it's several GraphQL/REST calls (Compound). A
`gh-pr-reactions <pr-number>` script that hardcodes the repo, takes only a PR
number, and does read-only GETs is the narrow, allowlistable slice. Raw
`gh api` stays gated; this one bounded read does not.
