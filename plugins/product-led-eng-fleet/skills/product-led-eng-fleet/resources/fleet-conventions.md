# Fleet conventions

The working agreement every fleet member honors. In a real repo these live in a
PM-maintained doc (commonly `ENG_TEAM_INSTRUCTIONS.md`) and are enforced by the bundled
`rules/`. Each rule traces to a real failure mode — keep the repo's copy to ~one page.

## Picking up work

1. **GitHub issues are the queue.** Before starting one, run
   `gh-queue ground-truth <N>`; if safe, claim it with `gh-label <N> add
   "in progress"` + `gh issue comment <N> "<intent>"`. Don't duplicate an open PR or
   another claimed issue. (`gh-queue`/`gh-label` come from the `github-fleet-tools` plugin, invoked by name.)
2. **Acceptance criteria are the contract.** They're written to be testable — implement
   against them and say so in the PR ("criterion N covered by test X"). If a criterion is
   wrong or unachievable, comment on the issue _before_ building around it.
3. **Deadlines and priority outrank file order.** `gh-queue list` already encodes this;
   don't reorder by hand.
4. **Don't implement issues marked undecided or deferred.** Labels like `needs-decision`
   (design unresolved) or `backlog` (deferred to a later cycle) mean "not for pickup." If
   you think one is actually ready, ask the PM to resolve/unlabel it — don't build around it.
5. **Blocked or descoping? Say so.** Comment what/why (`gh issue comment`) and release the
   claim (`gh-label <N> remove "in progress"`) so the queue reflects reality. Never go
   silent on a claimed issue.

## Building

6. **Specs govern.** Consult the governing spec/docs for your change; behavior changes
   update the matching doc **in the same PR**.
7. **Release notes / changesets** are required for any published-package behavior or
   public-type change; not for docs, CI, or marketplace content. Never a `major` bump
   without an issue explicitly authorizing it.
8. **Tests at the right layer.** Bug fixes ship a regression test that fails pre-fix.
   Anything touching a daemon, CLI surface, or plugin wiring gets integration coverage that
   exercises the **real input contract** (stdin payloads, hook command strings), not a
   hand-built approximation. "Tests pass" with the production contract untested is a
   signature bug class.
9. **Quality gate before opening a PR:** the repo's full check + affected suites green;
   regenerate any API report if the public surface changed. Run the formatter **before**
   every push and re-check it — formatters fail fast in CI and a slip masks test results.

## PRs, review, and merging

10. **Reference issues with `Refs #N`, never `Closes #N`/`Fixes #N`** — unless the PR
    genuinely completes the issue's full acceptance criteria. GitHub parses closing keywords
    anywhere in the body and will close tracking issues out from under the queue.
11. **Implementers stop at PR-open.** Open the PR, comment its link on the issue, and stop.
    Do **not** self-address review comments — the orchestrator runs the review cycle. If you
    keep going you'll likely push an un-formatted "fix" that bypasses review and fails CI.
12. **Every review comment gets a reply before merge** — what you changed, or why you
    respectfully didn't. Disagreement is fine; silence is debt. Resolve threads you've
    addressed.
13. **Comment the PR link on the issue** when you open it; close the issue only when the
    change is merged and the acceptance criteria are demonstrably met.

## Hard rules

14. **Never touch release/Version PRs** (e.g. an automated "Release packages" PR). Their
    blocked state is a deliberate human release gate.
15. **Never flip repo visibility, publish packages locally, or add/modify repo secrets.**
    Releases happen only through the CI pipeline.
16. **No internal codenames / wave numbers / agent attribution in public-facing content**
    (published packages, docs sites, npm READMEs). Repo-internal docs and issues may
    reference them freely; branch names are internal-only.
