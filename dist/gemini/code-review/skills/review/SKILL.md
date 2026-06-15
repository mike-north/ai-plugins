---
name: review
description: >
  Adaptive, host-neutral code review. Detects the project's stack, routes to specialist
  reviewer lenses, dispatches each as an agent with its own context window, and records
  findings as SARIF. Use when asked to review code changes, a branch, or a diff. This is
  the core "review" phase — it emits raw findings; triage and destination formatting are
  separate phases.
user-invocable: true
---

# Code Review — Review Phase

This skill is the **review** phase of a three-phase pipeline:

1. **set up work area** *(separate phase)* — normalize the changes under review into a work
   area on disk.
2. **review** *(this skill)* — analyze the diff through specialist lenses and emit findings.
3. **structure findings** *(separate phase)* — deduplicate, triage, and render to a
   destination (local display, GitHub PR review, …).

The phases communicate **only** through an on-disk **work area**, so this skill runs
standalone (it creates a minimal work area if none exists) and composes with the other
phases when they are present.

## Capability envelope (read first)

- **Findings-only and static.** Reviewers READ the diff and the source and report findings.
  They MUST NOT edit files, stage or commit, or run formatters, linters, tests, or CLIs.
  Some lens personas describe executable validation or suggested fixes that mutate files —
  **ignore those capabilities in this phase**; base every finding on reading the code.
- **Output is raw, un-triaged findings** written as SARIF. Deduplication, triage, verdicts,
  and destination formatting belong to the separate *structure findings* phase.
- A finding MAY carry a **suggested fix** as a structured replacement (region + new text).
  Never write ` ```suggestion ` blocks by hand — pass the replacement to `record-finding`
  and let deterministic tooling encode it.

## Work-area contract

```
<work-area>/                 # default: scratch/code-review/<id>/ ; or an existing dir/worktree
  meta.json                  # { baseRef, headRef, languages[], lenses[], createdAt }
  diff.txt                   # unified diff under review
  findings/
    <lens>.sarif.json        # one minimal-SARIF file per lens (written by record-finding)
```

## Tooling

Let `$SKILL` be the directory containing this file. Its `scripts/` directory holds the
deterministic tools — **always prefer them over doing mechanical work yourself**:

- `bash $SKILL/scripts/detect-stack.sh` — prints a JSON object describing the stack and the
  baseline lens set (`.agents`), plus a `resource_map` of supplemental knowledge files.
- `bash $SKILL/scripts/git-context.sh [stat|diff]` — diff of the current branch vs. its merge base.
- `node $SKILL/scripts/record-finding.mjs …` — validate + record ONE finding as SARIF.
- `node $SKILL/scripts/render-findings.mjs --work-area <dir>` — render findings as a summary.

(In Claude Code `$SKILL` is `${CLAUDE_PLUGIN_ROOT}/skills/review`. On other hosts, resolve it
relative to this SKILL.md.)

---

## Step 1 — Resolve the work area

If you were given a work area (or you are inside one — a `diff.txt` is present), use it and
**skip setup**. Otherwise create a minimal one:

```bash
REVIEW_ID="$(git branch --show-current 2>/dev/null || echo review)-$(date +%Y%m%d-%H%M%S)"
WORK_AREA="scratch/code-review/$REVIEW_ID"
mkdir -p "$WORK_AREA/findings"
bash "$SKILL/scripts/git-context.sh" diff > "$WORK_AREA/diff.txt"
```

If `diff.txt` is empty, tell the user there are no changes to review and stop.

## Step 2 — Route to lenses

1. **Deterministic baseline.** Run `detect-stack.sh` and take its `.agents` array as the
   starting lens set. Each id corresponds to a persona at `$SKILL/resources/lenses/<id>.md`.
   Note its `resource_map` — for any active lens with mapped resource files, include their
   contents (from `$SKILL/resources/<file>`) in that lens's prompt.
2. **Semantic augmentation.** Read the diff and the one-line `description` frontmatter of each
   persona in `resources/lenses/`. Add any lens whose description clearly applies to this
   change but that file-based detection missed (e.g. a security-sensitive change warranting a
   closer code-quality pass). This judgment step may be done by you directly or delegated to a
   cheap model; keep it bounded — only add lenses with a clear reason.

Record the final lens set and detected languages in `meta.json`.

## Step 3 — Dispatch the lenses

**Prefer delegation.** If you can run an agent with its own context window — a sub-agent in
your host, or a separate CLI session you spawn as a subprocess — launch **one per lens, in
parallel**, each using `resources/lenses/<lens>.md` as its reviewer persona. If you cannot
delegate, apply each lens **sequentially yourself**, fully resetting your focus between lenses
so they do not blur together.

Give every lens agent the same task wrapper:

> You are reviewing a code change through one reviewer lens. Your persona (role, focus areas,
> severity calibration) is the attached `resources/lenses/<lens>.md`.
>
> **Constraints:** Findings-only and static. Do NOT edit files, stage/commit, or run
> formatters/linters/tests/CLIs. Read `<work-area>/diff.txt` and the referenced source files
> under the repo root.
>
> **Record each finding** by calling the deterministic tool — never hand-write SARIF:
>
> ```bash
> node "$SKILL/scripts/record-finding.mjs" --work-area "<work-area>" --lens "<lens>" --root "<repo-root>" \
>   --json '{"ruleId":"<short-id>","severity":"critical|important|suggestion","message":"<what & why>","file":"<path>","startLine":<n>,"endLine":<n>}'
> ```
>
> - Omit `file` for a general (cross-cutting) finding; omit `startLine`/`endLine` for a
>   file-level finding.
> - `severity` maps to SARIF level: critical→error, important→warning, suggestion→note.
> - To suggest a fix, add `"fix":{"replacement":"<new text for the region>"}` (uses the
>   finding's region unless you also pass `fix.startLine`/`fix.endLine`). The tool validates
>   the line numbers against the real file and rejects out-of-bounds findings — fix and retry.
> - Every finding's message must explain WHY it matters, not just what is wrong.

## Step 4 — Render and present

After all lenses finish:

```bash
node "$SKILL/scripts/render-findings.mjs" --work-area "$WORK_AREA"
```

Present that summary to the user. Make clear these are **raw findings** — not deduplicated or
triaged — and that the work area persists at `$WORK_AREA/` for a downstream *structure
findings* phase (local triage, GitHub PR conversion) to consume.
