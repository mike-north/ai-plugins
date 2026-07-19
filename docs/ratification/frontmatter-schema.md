# Changeset frontmatter schema (draft)

> **Status**: draft. Program contract (consumers: judge, command steering, toolsmith).
> Becomes governing when Mike merges. Field names and enums below are proposals; the open
> questions at the bottom gate ratification. Once the judge starts writing changesets against
> this schema, changes are versioned, never silently breaking — escalate schema changes to the
> program lead (per [charter](../harness-program/charters/ratification-pm.md)).

Specifies the structured header of a ratification changeset file. Governing brief:
[the changeset layer](../harness-program/changeset-layer.md) §"The frontmatter schema".

## Why a schema, not prose

The changeset's second reader is the judge at PreToolUse decision time — a thousand machine
reads to the human's one merge. The frontmatter *is* the schema of the judge's crystallized
memory: a queryable index, not documentation. Governing principle, inherited from the brief:
**cheap deterministic lookup first; expensive reasoning only on a miss.** Every field earns
its place by being something a consumer queries deterministically ("have I already ruled on
this command shape?", "which rulings cited intent §3 that I just revised?", "which live rules
came from a judge older than version N?").

## Carrier and serialization

A changeset is a single Markdown file in a changeset package under the config monorepo (see
[bootstrap-flow](./bootstrap-flow.md)). Its header is a **YAML frontmatter block** delimited
by `---` fences; the body below the closing fence is human- and judge-readable prose (the
judge's risk template where applicable). The whole file is the unit attest-it seals — header
and body together — so any edit to either voids the seal.

```markdown
---
schemaVersion: 1
id: cs-2026-07-19-ssh-always-001
verdict: deny
direction: tightening
commandPattern: "curl * | sh"
# ... (full field set below)
---

## Ruling

<judge risk template: necessary-evil vs. low-concern, factors weighed>
```

YAML is chosen over TOML/JSON for parity with native changesets and the rest of the repo's
frontmatter (skills, agents), with the **strict-YAML caveat** the repo already enforces: any
scalar containing `: ` is quoted (Codex strict-parses frontmatter). `commandPattern` and
`triggeringObservation` values are quoted by default for that reason.

## Fields

Grouped by consumer concern. `req` = required on every changeset; `cond` = required under the
stated condition; `opt` = optional.

### Identity and lifecycle

| Field | Req | Type | Notes |
|---|---|---|---|
| `schemaVersion` | req | integer | This schema's version. Bumped only by a contract change. Consumers reject unknown majors → fail closed. |
| `id` | req | string | Stable, unique changeset id (e.g. `cs-<date>-<intent>-<seq>`). The supersede target and the audit-log key. |
| `ratificationStatus` | req | enum | `proposed` \| `ratified`. Set `proposed` by the porcelain tool; flipped to `ratified` at merge by the reconciler (or asserted by merge-to-`main` itself — see open questions). |
| `signerIdentity` | req | string | The attest-it identity slug that sealed this file (e.g. `judge`, or a human's slug). Attests **authorship**, never safety. Cross-checked against the seal in CI. |
| `supersedes` | cond | string \| null | `id` of the ruling this retires. Required when this changeset replaces a prior one; CI checks the target exists and is not itself already superseded (see [ci-validation-contract](./ci-validation-contract.md)). |

### The decision (the judge's queryable index)

| Field | Req | Type | Notes |
|---|---|---|---|
| `commandPattern` | cond | string | Machine-matchable shape of the governed command. **The single highest-leverage field** — turns "have I ruled on this shape?" into a lookup. Required for command-governing rulings; `null`/absent for non-command config (e.g. a pure tool admission). **Match semantics are command-steering's matcher, referenced by version, never reimplemented here ([D-011](../harness-program/DECISIONS.md)).** Until steering's matcher spec lands, this field is validated syntactically only. |
| `verdict` | req | enum | `deny` \| `redirect` \| `open`. Mirrors the steering verdict vocabulary (a change that *opens* is the only one that loosens, and only a human merge ratifies it). |
| `direction` | req | enum | `tightening` \| `loosening`. Redundant-by-design with `verdict` for cheap filtering and for enforcing "only humans loosen": any `loosening` changeset is a human-authored/human-ratified event. |
| `redirectTarget` | cond | string | For `verdict: redirect` — the approved replacement (a forged-tool invocation or safer command). Required iff `verdict = redirect`; must be runnable as-is (matches what the native rule allowlists). |
| `riskLevel` | opt | enum | `low-concern` \| `necessary-evil` \| (scale TBD). The judge's inherited calibration; body carries the reasoning. |

### Provenance (trust-drift discipline)

| Field | Req | Type | Notes |
|---|---|---|---|
| `intentRef.id` | cond | string | Stable intent id the decision interprets (e.g. `ssh-always`). The intents are the constitution; each changeset is case law citing its article. Required for intent-derived rulings. |
| `intentRef.version` | cond | string | Version of the intent document interpreted. Revise an intent → query every ruling that cited the old version. |
| `intentRef.sections` | cond | string[] | Numbered section(s) interpreted. |
| `judgeHarnessVersion` | cond | string | Which mind made the call. Required when the signer is an agent (the judge); enables "every live rule from a harness older than N" as a query on upgrade. Omitted/`null` for a human-authored changeset. |
| `triggeringObservation` | opt | string | The actual command/state that provoked the ruling — the judge's memory of the real attempt. Quoted (strict-YAML). |

### Scope (grant-tuple vocabulary — shared with toolsmith)

Reuses the grant tuple exactly (`hash × scope × expiry`); see
[how the pieces fit](../harness-program/how-the-pieces-fit.md) §"The grant tuple" and the
[steering↔toolsmith contract](../harness-program/contracts/steering-toolsmith.md) §1.

| Field | Req | Type | Notes |
|---|---|---|---|
| `scope` | req | enum | `global` \| `agent-type` \| `session`. |
| `scopeValue` | cond | string | The agent-type name or session id when `scope ≠ global`. |
| `expiry` | opt | string \| null | ISO-8601 instant or `null` (no expiry). Matches the grant-tuple expiry field. |

## Schema versioning

`schemaVersion` is load-bearing precisely because the byproduct changelog is (audit trail +
judge memory, per the brief). Rules:

- A **backward-compatible** addition (new optional field) does not bump the major; consumers
  ignore unknown optional fields.
- A **breaking** change (rename, semantic change, new required field, enum removal) bumps the
  major and is a contract change (party-PM sign-off + program lead + Mike). A migration note
  in [DECISIONS](../harness-program/DECISIONS.md) states how existing changesets are read.
- Consumers **reject an unknown major → fail closed to asking**. They never best-effort a
  header they don't understand.

## Open questions (gate ratification)

- **`commandPattern` match semantics** — *ruled* ([D-011](../harness-program/DECISIONS.md)):
  exactly one matcher program-wide, **owned by command-steering**, referenced by this schema by
  version, never reimplemented. Remaining work is coordination, not decision: agree the
  version-reference mechanics with the steering PM, and — when this schema ratifies — promote
  the binding to a steering↔ratification `contracts/` doc. `commandPattern` is validated
  syntactically only until steering's matcher spec lands (issue #85 proceeds on that basis;
  tracked in #92).
- **Who sets `ratificationStatus: ratified`?** Two candidates: the reconciler stamps it on
  apply, or merge-to-`main` *is* the ratified state and the field is advisory. Leaning the
  latter (the git state is the source of truth; a field can drift) — but it interacts with how
  the judge queries "ratified vs. proposed" from crystallized memory. Resolve with the judge PM
  in M2.
- **Serialization of `intentRef`** as nested YAML vs. flattened keys (`intentRefId`, …).
  Nested is cleaner; flattened is friendlier to grep-based deterministic lookup. Lean nested,
  confirm against the judge's actual query path.
- **Necessary-evil scale.** `riskLevel` enum values must match whatever calibration vocabulary
  the judge canon settles on — do not freeze ahead of it.
