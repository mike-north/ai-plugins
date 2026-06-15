# The orchestrator loop

One iteration of the fleet orchestrator. The orchestrator turns a ranked queue into
merged work by delegating to implementer sub-agents and owning the review cycle. It does
**not** write feature code itself — it triages, delegates, monitors, reviews, and merges.

## 1. Sync ground truth first

Local `HEAD` and the session's start-of-conversation snapshot are stale. Begin every
iteration from the remote:

```
git fetch origin <default-branch>
```

Read the repo's fleet-conventions file (often `ENG_TEAM_INSTRUCTIONS.md`) from
`origin/<default-branch>`, not the local copy — the PM maintains it and it changes.

## 2. Triage the queue (deterministically)

Run the engine, never an in-context diff (scripts live in `~/.claude/skills/git/scripts/`):

```
gh-queue.mjs list
gh-queue.mjs status
```

`list` is already ranked (deadline → priority label → issue number). Your only judgment
is choosing _among equally-ready_ items and how many to run in parallel. **Don't
manufacture work:** if the queue is saturated by in-flight PRs, the value-add is reviewing
ready (non-draft, CI-green) PRs or waiting — not duplicating claimed work.

## 3. Verify and claim

Before committing an agent to an issue, confirm it's both real and free:

- Re-confirm the problem still reproduces against `origin/<default-branch>` (not the local
  working copy or a stale read).
- `gh-queue.mjs ground-truth <N>` — exit 2 means an open PR already covers it or it's
  actively claimed; do not duplicate. A `STALE-CLAIM` verdict is takeable _after_ you
  announce intent on the issue.
- Claim = `issue-label.sh <N> add "in progress"` then `issue-comment.sh <N> "<intent>"`.
  Always ground-truth first; only act on a `SAFE`/`STALE-CLAIM` verdict.

## 4. Delegate to a fleet implementer

Dispatch a sub-agent (the `fleet-implementer` agent, or an inline Task) with a brief that
makes it self-sufficient — assume it has no conversation context. The brief must tell it to:

1. Branch off `origin/<default-branch>` into an isolated worktree.
2. Treat the issue's **acceptance criteria as the contract** and map each criterion to a
   named test, stated explicitly in the PR.
3. Update any governing spec/docs **in the same PR** (per the repo's conventions).
4. Run the repo's full check + affected tests green before pushing; format **before** every
   push (a formatter slip fails fast in CI and masks whether tests passed).
5. Commit with the correct authorship and **no AI-attribution trailers**.
6. Open a PR referencing the issue with `Refs #N` (never `Closes #N` — see conventions),
   request review, and comment the PR link on the issue.
7. **STOP at PR-open.** Do not self-address review feedback — the orchestrator runs the
   review cycle. (Implementers that keep going routinely push un-formatted "fixes" that
   bypass review and fail CI.)

**Tier (Axis 2):** premium model for spec-normative / edge-case-heavy issues; mid tier for
contained changes. Up to ~5 implementers in parallel for independent issues.

## 5. Monitor each PR by number

Launch a background PR monitor **targeting the PR number** (not "the current branch" — the
orchestrator sits on the default branch while the PR lives on a worktree branch). Implementer
sub-agents cannot monitor PRs themselves; they report back and you monitor.

When the monitor reports CI failures or review comments, dispatch a **fix** sub-agent that
addresses every item **and replies to every review thread** (what changed, or why you
respectfully didn't — silence is debt), then re-monitor. Reply + resolve a thread with
`pr-reply-resolve.sh <PR> <thread-comment-id> "<reply>"`, or clear an addressed batch with
`pr-resolve-threads.sh <PR>`.

## 6. Merge and close

On green CI + all review threads resolved, squash-merge with `pr-merge.sh <PR>`. That script
**prompts for approval by design** (merge is the one high-consequence write — grant it to the
PM/orchestrator context only) and additionally _refuses_ unless the PR is open, non-draft,
**not a release/Version PR**, has a **Copilot review present**, and has **passed required
checks**. Then close the issue with a criteria-met summary via
`issue-close.sh <N> "<summary>"` — PRs reference issues with `Refs`, so the merge won't
auto-close them.

## 7. Reflect

Capture recurring friction as durable memory; propose new rules/skills/hooks for repeated
manual steps — propose, don't self-modify. When a working-convention friction recurs
(review races, closing-keyword mistakes, queue-hygiene lapses), encode the fix in the
repo's fleet-conventions doc rather than correcting it per-PR.
