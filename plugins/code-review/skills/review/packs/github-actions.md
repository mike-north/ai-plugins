---
pack: github-actions
loads_into: [generalist]
verified: "2026-07"
sources:
  - https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
  - https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions
verify: "Check the repo's actual `.github/workflows/*.yml` for its current permissions/concurrency conventions before assuming the defaults below are unset."
---

# GitHub Actions

## Facts to check against

- **Missing `permissions` block.** Without one, the workflow's `GITHUB_TOKEN` gets broad default
  permissions. A workflow (or job) should declare the minimum it needs — `contents: read` as a
  baseline, with job-level overrides (e.g. `contents: write`) only where required.
- **Shallow checkout breaking git history operations.** `actions/checkout`'s default
  `fetch-depth: 1` breaks `git diff origin/main`, changelog generation, or any git-log-based
  operation — `fetch-depth: 0` is required when full history is needed.
- **Actions pinned to a mutable ref.** `@main`/`@master` (or even a moving major-version tag like
  `@v4` for a non-GitHub-official action) can be repointed to a malicious commit after the fact.
  Prefer pinning to a full commit SHA, with a comment noting which release it corresponds to;
  GitHub's own official actions pinned to a major-version tag are a common, accepted exception.
- **Hardcoded secrets.** Any credential value written directly into the workflow YAML instead of
  `${{ secrets.NAME }}` is permanently exposed in git history the moment it's committed.
- **Missing `concurrency` group.** Without one, every push to a PR branch runs a full duplicate
  CI job that isn't cancelled by the next push — `concurrency: { group: ..., cancel-in-progress:
  true }` for PR/CI workflows (use `cancel-in-progress: false` for deploy workflows, where an
  in-flight deploy shouldn't be interrupted).
- **No dependency caching.** Missing `cache:` on `actions/setup-node`/`setup-python` (or a manual
  `actions/cache` step) means every run re-downloads all dependencies from scratch.
- **`continue-on-error: true` on a whole job** silently turns real test/build failures green;
  reserve it for genuinely optional steps (an upload, a non-blocking notification).
- **Missing `timeout-minutes`.** The GitHub default job timeout is 6 hours — a hung step runs (and
  burns CI minutes) for the full default unless a job sets a reasonable `timeout-minutes`.
- **`pull_request_target` checking out PR code.** This trigger runs with the base branch's
  elevated permissions even for a fork's PR — checking out and executing the PR's own code under
  this trigger lets an external contributor run arbitrary code with write access. Safe uses are
  label/comment automation that never executes the PR's code; anything that needs to build/test
  untrusted PR code belongs under plain `pull_request`.
