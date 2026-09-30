# Review freshness — `gh-merge` guard 5

A reviewer's approval is only as good as the commit it looked at. After a review, authors
(and agents) keep pushing: they fix what the reviewer asked for, and sometimes they also add
things nobody reviewed. `gh-merge` refuses to merge unless the latest successful review from
a matching reviewer (Copilot by default) is **fresh**: it covers the current head.

This file is the design record for that guard. The implementation is
`lib/review-freshness-gate.mjs` (orchestration), `lib/review-freshness.mjs` (policy and
request shape), and `lib/typesafe-client.mjs` (HTTP client), called from
`scripts/gh-merge`.

## Which review counts

Guard 3 selects **R**, the commit of the latest *successful* review whose author matches
`PLEF_COPILOT_LOGIN_RE`. These don't count as reviews:

- Copilot's error notices ("Copilot encountered an error and was unable to review this pull
  request…"). A notice after a real review neither blocks nor refreshes it.
- Dismissed and pending reviews.

If every matching review errored, the merge is refused with the re-request command. If the
latest successful review has no commit, freshness is unknown and the merge is refused.

## Deciding freshness

If R is the PR head, the review is fresh. Otherwise:

1. **Remove base-branch movement.** Let `base_R` and `base_H` be where R and the head fork
   from the PR's base commit. `git merge-tree --merge-base=base_R base_H R` re-applies the
   reviewed change onto the head's base. Diffing that tree against the head leaves only the
   PR's own post-review edits. A rebase or a merge from the base branch leaves nothing.
2. **Handle deterministic cases with no model call:**
   - Edits in generated/mechanical paths are set aside. Defaults are `api-report/`,
     `docs/api/`, `.changeset/`, and package-manager lockfiles. `PLEF_FRESHNESS_IGNORE`
     replaces the list. `dir/` matches a directory at any depth, `name` matches a basename
     glob, and `a/b/*.ts` is a root-anchored glob in which `**` spans directories. A pattern
     that would exempt ordinary source everywhere (`*`, `**`, `*/`, …) is refused.
   - Paths where the reviewed change **conflicts** with the new base need review: the
     conflict resolution was never reviewed.
   - **Binary** changes need review.
   - More than 40 hunks needs review ("too large to judge").
3. **Judge each remaining hunk** with TypeSafe's Jev model, one System One request per hunk.
   The state holds:
   - `change`: the hunk (file and unified-diff text);
   - `review_threads`: every review thread **started by the matching reviewer**, with its
     file, line, resolution, and comments (replies from anyone are kept as discussion);
   - `other_changes`: the push's other hunks as context, in full text when they total at
     most 6000 characters, otherwise just their headers.

   The request asks three independent questions:
   - **Choice** `addresses`: which review thread's feedback `change` carries out, or
     `mechanical` (no change to behavior or meaning), or `new_change` (a response to no
     thread).
   - **Noul** `beyond`: does `change` do more than any thread asked for?
   - **Noul** `mechanical`: is `change` purely mechanical?

   Why one request per hunk: Jev's accuracy falls as state fills with content unrelated to
   the decision. Each request therefore carries one hunk to judge, the feedback, and a
   bounded amount of sibling context. Sibling context was added after calibration showed
   that a cross-file fix is only recognisable with it. In a refactor the reviewer asked
   for, the new helper sits in one file and its call sites in another.
4. **Apply the policy** below. Every hunk must be covered for the review to be fresh.

Threads started by humans are deliberately not offered as feedback to address. The question
is whether *this reviewer's* review still covers the head. An edit a human asked for was
still never seen by that reviewer.

## Policy (asymmetric)

A hunk is **covered** only when every signal agrees. Any doubt means a fresh review.

| Top answer of `addresses` | Covered only if                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| a review thread           | confidence ≥ **0.7**, P(`new_change`) < **0.2**, `beyond` < **0.5**                                                  |
| `mechanical`              | confidence ≥ **0.9**, `mechanical` ≥ **0.8**, P(`new_change`) < **0.2** (no thread bounds it, so two confirmations) |
| `new_change`              | never                                                                                                                |

A missing answer, probability, or signal counts against the hunk.

These are also refusals that state their reason:

- a missing `TYPESAFE_API_KEY` (when a hunk needs judging);
- any TypeSafe HTTP error (after 2 retries of 408/429/5xx/network, mirroring the SDK);
- an incomplete or ill-typed answer set;
- a git, `gh`, or fetch failure;
- running outside a clone;
- a single request estimated above 24k tokens (the model allows 32k for state plus the
  longest question).

The model is pinned to `jev-1.13.0`. The thresholds are calibrated against that version, so
a model change needs re-calibration.

## Calibration (jev-1.13.0)

Calibration used the real gate code path against the history of the `sarif-to-comment`
repository, with review threads read from GitHub. It covered 28 labelled
(reviewed commit → head) cases:

- **10 expected covered:**
  - Real Copilot-requested fixes: PR #20 (doubled phrase) and PR #21 (code-format a path,
    after a rebase).
  - The rebase-only step of PR #21.
  - Six real single commits, each paired with a Copilot-style thread written to request
    exactly that change. Some add a regression test, and one refactor spans two files.
  - One formatting-only rewrap with no thread.
- **18 expected to need review:**
  - PR #15's real post-review commits (Copilot re-reviewed them).
  - Real follow-up work stacked on reviewed PRs (#16→#17, #25→#26, #32→#33).
  - An unrequested real fix.
  - Real Copilot fixes combined with real unrelated edits: docs, tests, and a behaviour
    change.
  - Real commits paired with threads about something else.

**Results:** 28/28 cases correct. Per hunk: 25/25 covered hunks passed, and 76/76 new-work
hunks were refused. Three cases (rebase-only, a conflicted rebase, a 78-hunk push) were
decided without the model.

| Signal (per hunk)                      | Covered hunks      | New-work hunks                       | Threshold |
| -------------------------------------- | ------------------ | ------------------------------------ | --------- |
| thread confidence                      | min 0.96           | none chose a thread                  | ≥ 0.7     |
| P(`new_change`), thread-mapped         | max 0.01           | min 0.17 (a hunk labelled mechanical) | < 0.2     |
| `beyond`, thread-mapped                | max 0.38           | min 0.53                             | < 0.5     |
| mechanical: confidence / `mechanical`  | 0.99 / 0.91        | max 0.74 / max 0.67                  | ≥ 0.9 / ≥ 0.8 |

Two earlier iterations were rejected on this evidence:

- **Without sibling context,** a reviewer-requested cross-file refactor was refused: the
  helper's definition hunk scored as a new change (confidence 0.27).
- **Applying `beyond` to mechanical hunks** refused a pure rewrap (`beyond` 0.6–0.69).
  `beyond` is still the signal that catches real edits the Choice mislabels "mechanical"
  (0.79–0.81 on those). The mechanical path therefore uses the independent `mechanical`
  Noul in its place.

Caveats: this is a small sample from one repository, and most "covered" threads were
written for calibration rather than drawn from real reviews. Most PRs in that history had
no Copilot inline threads. Treat the thresholds as a conservative starting point. Re-run
calibration on a new model version, or when false refusals become frequent. `--dry-run`
prints every hunk's scores for exactly this purpose.

## Configuration

| Variable                    | Meaning                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY`          | TypeSafe key, read from the environment only; needed when a hunk must be judged        |
| `TYPESAFE_BASE_URL`         | API root (default `https://api.typesafe.ai`)                                           |
| `PLEF_TYPESAFE_MAX_RETRIES` | retries for transient API errors (default 2)                                           |
| `PLEF_FRESHNESS_IGNORE`     | comma list of generated/mechanical path patterns (replaces the defaults)               |
| `PLEF_GIT_REMOTE`           | remote to fetch missing commits from (default `origin`)                                |
| `PLEF_COPILOT_LOGIN_RE`     | reviewer login pattern; also selects whose threads count as feedback                   |
