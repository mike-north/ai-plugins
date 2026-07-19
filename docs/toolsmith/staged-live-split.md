# The staged/live split: killing the re-sign lockout

Toolsmith PM · 2026-07-19 · design for issue #75

Governing canon: [Toolsmith, narrowed](../harness-program/toolsmith-narrowed.md) §"What's new:
the staged/live split"; [steering ↔ toolsmith contract](../harness-program/contracts/steering-toolsmith.md)
§1 (registration), §2 (integrity predicate); program invariants (fail closed to asking · only
humans loosen · approval is content-addressed). Existing toolsmith canon this extends:
`registry-schema.md` (skill references), the approve handshake.

## Problem

Hash-pinned approval has a lockout: propose a one-line improvement to a signed tool and the
hash drifts, so the tool is dead until a human re-signs — an hour, a day. The brief's fix is a
git-shaped split: the agent authors in **staging** (never executable), keeps using the
last-approved **live** version meanwhile, and a human-ratified **promotion** moves content
from staging to live. This document specifies the on-disk contract, the write-denial
mechanism and its honest limits, the promotion step, and the registry/schema changes.

## Design decisions, stated up front

1. **Existing tool locations *become* live — no path migration.** Live is not a new
   directory; it is the write-protection + promotion discipline applied to the paths that
   already exist (`<home>/.claude/toolsmith/tools/` for user scope,
   `<projectRoot>/scripts/agent-tools/` for project scope). Rationale: every approved tool's
   `permissionRule` embeds its path (`Bash(<path>:*)`); relocating live would void every
   grant and force a global re-approval — maximal churn for zero security gain. The split is
   a *state machine*, not a re-homing.
2. **Staging is a sibling namespace, mirrored by scope**:
   `<home>/.claude/toolsmith/staging/<name>` and
   `<projectRoot>/.claude/toolsmith/staging/<name>`. One file per tool draft — a new tool or
   a proposed revision of a live one, distinguished only by whether a live entry with that
   name exists.
3. **The registry stays the single source of truth.** No new state files: entries gain
   optional staged fields (below), and the lifecycle is readable from the registry alone.
4. **Promotion is shaped as an apply manifest from day one.** The interim promoter is
   `/toolsmith:approve`; per D-010 the ratification layer's reconciler eventually executes
   declarative apply manifests. Approve therefore *internally* computes a manifest
   (place file → set mode → update pin → ensure rule) and executes it, so the reconciler
   swap replaces the executor without changing the on-disk contract.

## The three states

| State | Where the bytes live | Executable | Native rule | Steering registration |
|---|---|---|---|---|
| **Staged** (new or revision) | `…/staging/<name>` | never (0644) | none | none — steering never sees staging |
| **Live** | the tool's registered path (unchanged from today) | yes (0755) | `Bash(<path>:*)` | covers + pin + grants per contract §1 |
| **Retired** | removed from live path; registry entry deleted or `status: retired` | — | rule removed | registration removed |

An **edit to a live tool never touches live**: the draft accumulates in staging while live
keeps serving the last-approved bytes under the last-approved pin. There is no state in which
a tool is simultaneously modified and granted — the lockout is gone because the *drift never
happens in place*.

## Write denial on live: mechanism and honest limits

Constraint: the agent and the human are the same macOS user. Nothing below is
root-privileged, so **no layer here is adversarially unbypassable** — consistent with the
program's stated threat model (accident prevention and desperation pushback, not anti-malice;
the judge brief owns that framing). The design is three stacked layers, each catching what
the previous misses, each leaving a bypass *visible and deliberate* rather than silent:

1. **Filesystem: mode + immutable flag.** Live tool files are `0555` (r-x, no write) and
   carry the BSD user-immutable flag (`chflags uchg`). Promotion clears the flag, writes,
   re-sets it (`uchg` → write → `uchg`). An accidental in-place edit — the overwhelmingly
   common failure, and the exact write activity forging legitimately does constantly in
   staging — fails immediately with EPERM. *Limit*: the same user can `chflags nouchg`; that
   is a distinct, greppable, two-step act, not an accident.
2. **Harness permission: deny writes to live paths.** The harness config gains deny rules
   for Edit/Write/NotebookEdit on the live directories (and `Bash(chflags:*)`,
   `Bash(chmod:*)` against those paths stay outside the allowlist, so flag-stripping falls
   to ask). This blocks the agent's *native editing tools* from touching live even before
   the filesystem says no. *Limit*: per-harness support for path-scoped write-deny rules
   varies; where a harness can't express it, layer 1 still holds. The exact rule set ships
   with this feature and is documented in the skill references.
3. **Steering integrity pin (contract §2).** If bytes at the live path nonetheless drift
   from the registered pin, invocation fails closed to ask. This is the backstop that makes
   layers 1–2 *safety*, not *security*: even a successful out-of-band write (dotfile sync,
   manual edit, flag-strip) cannot ride the standing grant.

The three layers honor content-addressing end to end: the pin is authoritative, the
filesystem makes accidents fail fast, the harness rules make the common tools refuse
politely, and every bypass path terminates at ask — never at silent execution of unapproved
bytes.

**Staging is inert by construction, not by enforcement.** Files are 0644 and no allow rule
names them, so both invocation routes fall to the normal ask flow: direct execution fails
(`no execute permission`), and interpreter invocation (`bash staging/<name>`) matches no
allowlist rule. No noexec mount tricks, no new mechanism — the absence of a grant *is* the
mechanism, which is exactly the brief's "a draft is inert" posture.

## Registry schema changes

Additions to a tool entry (all optional; absent = today's semantics):

```jsonc
{
  "name": "gh-pr-reactions",
  "path": "scripts/agent-tools/gh-pr-reactions",   // live path — unchanged
  "status": "approved",                             // approved | draft | retired
  "approvedSha256": "…",                            // the live pin — unchanged
  "staged": {                                       // present iff a draft exists
    "path": ".claude/toolsmith/staging/gh-pr-reactions",
    "sha256": "…",                                  // advisory; recomputed at promotion
    "note": "adds --json flag",                     // one-line agent-authored change summary
    "since": "2026-07-19T18:00:00Z"
  }
}
```

- A brand-new tool is `status: draft` with only `staged` populated (no live path fields
  active) — same as today's draft semantics, now with a mandated location.
- `staged.sha256` is advisory bookkeeping for `/toolsmith:list` (show drift, show pending
  drafts); promotion **recomputes** the hash from bytes at promotion time — the pin is
  derived from what is actually placed, never trusted from the registry
  (time-of-check = time-of-use, per the design-patterns guard rule).
- `/toolsmith:list` gains a pending-drafts section: name, note, staged-since, and whether
  live has meanwhile changed (three-way: live pin vs. registry vs. staged).

## Promotion

`/toolsmith:approve <name>` (interim; flag-compatible with today's path argument) becomes:

1. **Gate**: lint the staged file (existing proposal gate); refuse on failure.
2. **Review surface**: show the human the staged content — as a *diff against live* for a
   revision, full text for a new tool — plus the registration data that ships with it
   (covers, invocation template, grants). What is reviewed is exactly what is placed.
3. **Seal** (once #76 lands): attest-it seal over the staged content; promotion refuses
   without a valid seal. Until #76: the existing approve confirmation stands in.
4. **Apply** (the manifest, executed deterministically and idempotently):
   `nouchg` live path (if exists) → atomic place (write temp, rename) → `0555` + `uchg` →
   recompute + write pin → ensure `permissionRule` in the target settings → clear `staged`
   from the entry → remove the staging file.
5. **Register**: emit/update the steering registration per contract §1 (#77's artifact once
   specified; today, the registry fields the hook already reads).

Failure anywhere before step 4 leaves live untouched and the draft in staging. A failure
*inside* step 4 leaves at worst a live file whose pin doesn't match — which fails closed to
ask (layer 3) until approve is re-run; the apply is idempotent so re-running converges.
Nothing in promotion is reachable without the human act (step 2/3) — only humans loosen.

**Demotion/retirement** (`revoke`, small and symmetric): remove rule → remove registration →
remove/immutable-clear live file → mark entry retired. Also human-gated (it's a capability
change in the dangerous direction only in the sense of availability; still routed through
approve's ceremony for auditability).

## What this deliberately does not do

- **No tool-development harness.** Draft *execution* under the judge is M2+ scope
  (toolsmith-narrowed §"tool-development harness"); until then drafts are simply inert and
  iterated without execution, or executed under a one-off human ask.
- **No graduation state machine.** `status` gains no supervised/monitored states yet.
- **No changeset-layer integration.** Approve is the interim promoter; the apply-manifest
  shape is the seam the reconciler (D-010) takes over. No registration-artifact freeze
  either — #77 owns that; step 5 writes today's registry fields.
- **No steering-side changes.** The integrity predicate is contract §2 / issue #73
  (steering's). This design only guarantees the pin's producer side.

## Acceptance criteria (test-backed)

1. **Lockout dead**: with tool T approved and live, writing a staged revision of T leaves
   `T`'s live invocation running and passing its pin; `/toolsmith:list` shows the pending
   draft. (Regression test: the exact scenario the brief opens with.)
2. **Staged inert**: executing a staged file directly fails (mode); `bash <staged>` falls to
   the normal ask flow (no rule). Test both routes.
3. **Live write-denied**: an in-place write to a live tool file fails with EPERM (mode +
   `uchg`); after a forced out-of-band edit (`nouchg` + write in the test), invocation falls
   to ask via the pin, never runs silently. (The second half exercises today's hash check
   until #73 relocates it.)
4. **Promotion atomicity + idempotence**: kill promotion between place and pin-write →
   invocation asks (never silent-runs); re-run approve → converges to live+pinned+granted.
5. **New-tool flow**: draft → staged → approve → live+granted, end to end, with the
   review surface showing exactly the placed bytes.
6. **No hot-path regression**: the staging namespace adds zero reads to steering's
   not-opted-in path (#38 budget unchanged — nothing consults staging at hook time).
7. Docs: `registry-schema.md` and the authoring checklist updated; the write-denial layers
   and their honest limits documented where the forging skill will hit them.

## Rollout

Ships as toolsmith **0.5.0**: additive registry fields, existing approved tools untouched
until their next promotion (at which point they acquire mode+flag protection); a one-time
`migrate` step in approve applies 0555+`uchg` to already-approved live files on first run.
