# Registration emission: the toolsmith → steering artifact

Toolsmith PM · 2026-07-19 · design for issue #77

> **Status**: **draft proposal**. This document specifies **toolsmith's emission side** of
> [contract](../harness-program/contracts/steering-toolsmith.md) §1. The artifact it describes is
> *read* by command-steering, so the schema is a **shared surface**: it becomes binding on steering
> only with the steering PM's sign-off. If it proves to need contract status, it graduates into the
> contract doc by the contract-change process (both party PMs + program lead + Mike's merge) — the
> same path the [matcher contract](../command-steering/command-pattern-matcher.md) §4–5 reserves.
> Nothing here is authored unilaterally as binding on the other party.

Governing canon: [contract](../harness-program/contracts/steering-toolsmith.md) §1 (registration),
§2 (runtime predicates), §3 (verdict payloads); the
[matcher contract](../command-steering/command-pattern-matcher.md) (D-011 — pattern shape and
version pinning); the [verdict payload schema](../command-steering/verdict-payload-schema.md)
(which fields toolsmith fills); [staged/live split](./staged-live-split.md) (when emission happens);
[attest-it admission](./attest-it-admission.md) (what the seal covers).

## The one-way rule, made structural

**Data flows toolsmith → steering; control never flows back.** Today the hook reads the registry
directly because both live in one plugin. After the extraction (#74) that becomes an explicit
interface, and the discipline has to survive the split:

- Toolsmith **writes** registration facts; steering **reads** them. Steering never writes toolsmith
  state; toolsmith never reads steering verdicts at runtime.
- Emission happens **only at admission/promotion** — a human-ratified moment — never at hook time.
  A registration is therefore always the product of a completed promotion, and steering can treat it
  as authoritative-until-superseded without re-deriving anything.

## Decision: steering reads toolsmith's registry (no duplicate artifact)

Two options were live: (a) toolsmith writes into a steering-owned config file, or (b) steering reads
toolsmith's registry directly under a documented, versioned read contract.

**Chosen: (b), with the registry's registration-relevant fields declared a stable read surface.**

Rationale — (a) creates a second copy of facts that already have a home, and every copy is a drift
surface: a tool could be live-and-pinned in the registry while a stale steering config still names
the old hash, and the two would disagree exactly when it matters (integrity check). One artifact
means "the tool is admitted" and "steering knows the tool is admitted" cannot diverge. The cost of
(b) is that toolsmith's registry schema gains a versioned public contract — which it needs anyway,
since #68 already made its layering semantics load-bearing for steering.

Consequence: `registry.json`'s registration-relevant subset is **read-only public API for
steering**, versioned, and changed only with the same reader-stability discipline steering applies
to its telemetry surface.

## The registration record

Per tool, the registration-relevant subset of an approved registry entry:

```jsonc
{
  "name": "gh-pr-reactions",
  "registrationVersion": 1,              // schema version of THIS subset (see §versioning)
  "path": "scripts/agent-tools/gh-pr-reactions",   // live path; scope-relative per registry-schema.md
  "status": "approved",                  // only "approved" registers; draft/retired never do
  "approvedSha256": "…",                 // the integrity pin (contract §2)
  "permissionRule": "Bash(scripts/agent-tools/gh-pr-reactions:*)",
  "purpose": "Read emoji reactions on review comments for a PR in this repo",
  "args": "<pr-number>",

  "covers": [                            // detection patterns — matcher contract shape
    {
      "pattern": "gh(_\\w+)?\\s+api\\b.*repos/(?<repo>[\\w.-]+/[\\w.-]+)/pulls/(?<pr>\\d+)/comments",
      "matcherVersion": "1.0.0"
    }
  ],
  "invocationTemplate": "{tool} --repo {repo} --pr {pr}",   // or null → bare pointer
  "rationale": "PR review comments via a narrow tool; broad gh api stays gated",

  "grants": [                            // grant tuples (contract §1)
    { "scope": "global", "expiry": null }
  ]
}
```

Field-by-field, with the consumer named:

| Field | Consumer | Contract |
|---|---|---|
| `path`, `permissionRule` | steering (registered-target identification; runnable-redirect check) | §1, §3 invariant 2 |
| `approvedSha256` | steering integrity predicate | §2 |
| `covers[]` | steering matcher | §1; matcher contract §2 |
| `invocationTemplate` | steering `redirect.filledInvocation` (Tier 1 fill) | verdict schema |
| `purpose`, `args`, `rationale` | steering `redirect.rationale` / reason text | verdict schema §field ownership |
| `grants[]` | steering grant predicate | §2 |
| `status` | steering (gate: only `approved` registers) | §1 |

**`covers` migrates from bare strings to `{pattern, matcherVersion}` objects** (matcher contract §2).
Toolsmith stamps `matcherVersion` at admission by reading steering's active-version surface (matcher
contract §5) — so a pattern records the semantics it was *authored and reviewed against*, and a later
matcher upgrade cannot silently re-interpret it. Migration: a bare-string `covers` entry is read as
`{pattern: <string>, matcherVersion: "1.0.0"}` (the extraction baseline), so existing registries keep
working; new/re-promoted tools get an explicit stamp.

## Where captures and the template must agree

`invocationTemplate` placeholders must be exactly the named capture groups declared in that tool's
`covers` patterns, plus `{tool}`. This is checkable at admission and **must** be checked there:

- A template naming a capture no pattern declares can never fill → silently degrades every redirect
  to a bare pointer.
- A capture using a wide class (`.+`) violates the matcher contract's narrow-class safety rule
  (captures are attacker-adjacent and get echoed into a suggested invocation).

The proposal gate (`lint`) enforces both at admission time, so a malformed registration cannot be
promoted. This is the cheap, deterministic half of the redirect-runnability invariant (contract §3
invariant 2 / the #36 §1 deadlock rule); the other half is that `invocationTemplate`'s rendered form
must match what `permissionRule` allowlists — also lint-checkable, since both are in the same record.

## Scope layering (unchanged semantics, now contractual)

Registration inherits the shipped, tested resolution rules — **this spec adds no new layering
semantics**, it declares the existing ones part of the read contract:

- Registries resolve project + user scope with **project shadowing user on name collision**
  (`registry-schema.md` shared-contract table).
- Config layering is defaults → user → project (#68/#69, toolsmith 0.4.0).
- Path resolution is scope-relative exactly as the shared-contract table specifies (project-relative;
  user entries relative to `<home>/.claude/toolsmith/` with the `tools/` prefix rule).
- `$HOME`-rooted sessions resolve the two registries to one file and read it **once**
  (`projectIsUserRegistry`, #36/#45).
- Malformed registry in either scope = absent **for that scope only**, fail-open (that scope's
  registrations simply don't exist; the other scope is unaffected). Note the asymmetry that makes
  this safe: a missing registration removes a *redirect* (a hint) and removes an *integrity pin* — and
  a tool with no pin has no standing grant to ride, so the failure degrades toward asking, never
  toward silent execution.

## Versioning and the reader contract

- `registrationVersion` versions **this subset's shape**, independent of the registry file's own
  `version`. Steering pins the major it understands.
- **Unknown major → that entry does not register**, and steering degrades any command that would
  have matched it to `ask` (fail closed, matching the matcher contract's version-skew rule). It must
  never be read optimistically.
- Additive fields are minor bumps; removing/retyping a field or changing a field's meaning is major.
- Toolsmith must not change the registration-relevant subset's shape without a version bump —
  the writer-side mirror of steering's telemetry reader-stability rule (contract §5).

## Emission points and lifecycle

| Event | Registration effect |
|---|---|
| **Promotion** (`approve`, staged/live §Promotion step 6) | write/update the record: pin recomputed from placed bytes, `covers`/template/grants from the reviewed surface, `matcherVersion` stamped |
| **Revision promoted** | record updated in place (new pin); no window where the record names bytes that aren't live — the pin is written from what was placed |
| **Revoke** (#120) | record removed **before** the live file, so steering can never redirect to a target that is already gone |
| **Draft created / staged edit** | **nothing** — staging is invisible to steering (staged/live §three states) |

The writer swaps without the reader noticing: today `approve` writes the record; after the
ratification layer lands, the reconciler (D-010) applies the same record from a ratified changeset.
Steering reads the same file either way — which is the point of choosing (b).

## Acceptance criteria

1. **Schema doc** for the registration record with every field's producer and consumer named, and
   `registrationVersion` semantics stated (this document, on merge).
2. **`covers` object migration** implemented with bare-string back-compat read as `matcherVersion:
   "1.0.0"`; existing registries keep redirecting with no edit. Regression test both forms.
3. **`matcherVersion` stamped at admission** from steering's active-version surface; a test asserts
   the stamp is read from that surface, never a hardcoded literal (the no-hardcoded-versions rule).
4. **Lint enforces template/capture agreement** and narrow capture classes: a template naming an
   undeclared capture, or a pattern using a wide class, fails the proposal gate and cannot be
   promoted. Negative tests for each.
5. **Lint enforces redirect runnability**: the rendered invocation form matches what
   `permissionRule` allowlists (the #36 §1 deadlock rule) — negative test with a mismatched rule.
6. **One-way rule holds by construction**: no steering code path writes registry state; no toolsmith
   runtime path reads steering verdicts. Asserted by review, and by the absence of any write in
   steering's registry-read module once #74 lands.
7. **Round-trip**: admit a tool → record appears → the covered raw command is redirected to the
   runnable target; revoke → redirect stops. (Interim: against today's in-plugin hook; after #74,
   against the extracted engine.)
8. **Docs**: `registry-schema.md` updated with the registration subset and its version.

## Sequencing and dependencies

- **Spec (this doc)**: now — the matcher contract is merged and citable, the verdict schema names its
  filler fields.
- **Implementation**: gated on **#74** (engine extraction) so we don't build against a moving reader,
  and it should land with or immediately after it. The `covers` object migration is the one piece
  that could ship earlier (it's back-compatible and toolsmith-local).
- **Steering PM sign-off** required before this binds steering (status note above).

## Non-goals

- The verdict payload schema (steering's #72) and the matcher semantics (steering's #95) — referenced,
  never redefined here.
- The changeset/ratification carrier (the reconciler writes the same record; the ceremony is
  ratification's).
- Grant *evaluation* semantics (steering's #73) — this spec fixes only how grants are **carried**.
- Telemetry (contract §5, steering-owned; toolsmith is a reader).
