# Fleet conventions (standing rules)

Apply when working any repo that uses the product-led-eng-fleet pattern.

- **Detect the queue with code, not context.** Use the companion scripts in
  `~/.claude/skills/git/scripts/`: read-only `gh-queue.mjs` (`list` / `ground-truth` /
  `status`) for detection, and the bounded write-scripts (`issue-label.sh`,
  `issue-comment.sh`, `pr-merge.sh`, …) for actions. Never re-pull and diff issues in your
  own context, and never trust a stale local checkout — `git fetch` first.
- **Writes go through the bounded scripts, never raw `gh api`.** Each script wraps one `gh`
  mutation with no arbitrary-API escape hatch, so it's allowlistable; arbitrary `gh api`
  stays human-gated on purpose.
- **Ground-truth before claiming.** An open PR (even draft) referencing an issue means it's
  in flight — do not duplicate. A claimed-but-silent issue with no PR is a stalled claim,
  takeable only after announcing intent on the issue.
- **Acceptance criteria are the contract.** Map each criterion to a named test and say so in
  the PR. Raise a wrong/unachievable criterion on the issue before building around it.
- **Reference issues with `Refs #N`, never `Closes`/`Fixes`** unless the PR truly completes
  the issue — closing keywords close tracking issues out from under the queue.
- **Implementers stop at PR-open.** The orchestrator runs the review/fix cycle. Don't
  self-address review comments or push follow-up "fixes" — that bypasses review and CI.
- **Reply to every review comment before merge.** What changed, or why you respectfully
  didn't. Silence is debt.
- **Format before every push** and re-check; the formatter fails fast in CI and a slip masks
  test results.
- **Never touch release/Version PRs**, flip repo visibility, publish locally, or modify
  secrets. No internal codenames / wave numbers / agent attribution in public-facing content.
- **Don't manufacture work.** If the queue is saturated by in-flight PRs, review ready PRs or
  wait — don't duplicate claimed work.
