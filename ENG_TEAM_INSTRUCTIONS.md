# Engineering Team Instructions

Conventions for the engineering fleet working this repo. The PM agents maintain this file;
repo/codebase specifics live in `README.md` and each plugin's docs — this covers how we work
together.

## Governance: canon over issues

1. **Design canons govern.** Each product's canon lives in `docs/<project>/` (`toolsmith`,
   `customizations`, and the harness-program projects under `docs/harness-program/` with the
   roster in its [README](docs/harness-program/README.md)). Where an issue and its governing
   canon disagree, **the canon wins until amended** — comment on the issue rather than
   building the divergence.
2. **Issues must cite canon.** A pickup-ready issue names the canon section(s) it implements
   under "Governing references". An issue with no citation isn't ready — say so and move on.
3. **Cross-project contracts** live in `docs/harness-program/contracts/`. If your change
   touches a contract surface (registration format, verdict payload, changeset frontmatter,
   grant tuple), the PR must link the contract doc; changing the contract itself requires
   both party PMs' sign-off and Mike's merge — never do it unilaterally inside a feature PR.

## Picking up work

4. **GitHub issues are the queue.** Claim by adding the **`in progress`** label and check
   you're not duplicating an open PR or another claimed issue. Queue tooling: `gh-queue` /
   `gh-label` with `PLEF_PRIORITY_LABELS="P1,P2,P3"`.
5. **Acceptance criteria are the contract.** Map each criterion to a named test and say so
   in the PR. Wrong/unachievable criterion → comment on the issue *before* building around
   it.
6. **Not for pickup:** `needs-decision` (design unresolved — a `decider: program-lead` or
   `decider: mike` label routes the escalation; no decider label means the line PM decides)
   and `backlog` (decided but deferred). Deadlines in titles (`due YYYY-MM-DD`) outrank
   undated work.
7. **Blocked or descoping?** Comment what/why and drop the `in progress` label. Never go
   silent on a claimed issue.

## Building

8. **The three invariants** of the harness program apply to every PR in its plugins
   (steering, judge, ratification, harnesses, toolsmith):
   - **Fail closed to asking** — verification failures degrade to the human-approval flow;
     never silent denial, never silent allowance.
   - **Only humans loosen** — agents may propose anything and unilaterally tighten; opening
     any capability requires human ratification.
   - **Approval is content-addressed** — seals/pins bind exact content; any change voids.
   A change that breaks one is wrong regardless of local merit — flag it, don't ship it.
9. **Spec-audit before merge** on any PR implementing canon-cited behavior: verify the
   implementation against the cited sections (`spec-skills:spec-audit` is the tool).
   Deviations become filed bugs or canon-amendment proposals — never silent drift. Behavior
   changes update the governing canon/spec **in the same PR**.
10. **Quality gate before opening a PR:** `pnpm check` (aipm build + validate), `pnpm lint`,
    `pnpm test` green. Skill frontmatter is strict YAML (Codex strict-parses it — quote
    values containing `: `).
11. **Tests at the right layer.** Bug fixes ship a regression test that fails pre-fix.
    Hook scripts and CLI surfaces get integration coverage against the real input contract
    (stdin payloads, `hooks.json` command strings), not hand-built approximations.

## PRs, review, and merging

12. **Reference issues with `Refs #N`, never `Closes #N`/`Fixes #N`** unless the PR
    genuinely completes the issue's full acceptance criteria.
13. **Implementers stop at PR-open.** The orchestrator (or owning PM) runs review/fix cycles
    and merges. Comment the PR link on the issue; close the issue only when merged and the
    criteria are demonstrably met.
14. **Review replies are mandatory** when a review with comments lands: every comment gets a
    reply (what changed, or why respectfully not) before merge.

## Hard rules

15. **Never touch Version/release PRs**; never publish locally, flip visibility, or modify
    secrets. Releases are Mike's gate.
16. **Commit as `Mike North <michael.l.north@gmail.com>`; no AI-attribution trailers.**
17. **No internal codenames/wave numbers in public-facing content** (published plugin
    content, npm READMEs). Repo-internal docs and issues may use them freely.

## Context that helps

- The harness program (`docs/harness-program/`) is the current campaign: command-steering
  extraction, the ratification layer, and toolsmith's staged/live split (M1 in its
  [ROADMAP](docs/harness-program/ROADMAP.md)). Contract-adjacent work punches above its
  weight; when in doubt about ownership, the roster table routes it.
- Review priorities: permission/verdict correctness, hook hot-path latency, and
  fail-closed behavior outrank style.
