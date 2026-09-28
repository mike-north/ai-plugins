# Contract: command-steering ↔ ratification

> **Status**: drafted 2026-07-19 by the program lead from the parties' recorded agreement
> — the matcher spec (`docs/command-steering/command-pattern-matcher.md`, merged PR #97)
> §2–§5, the field-shape agreement on issue #92, and the ratification PM's itemized
> sign-off posted on PR #97. **Pending each party PM's formal ack on this document's PR**,
> then finalized alongside the frontmatter schema's ratification. Parties: command-steering
> PM, ratification PM. Changes require both parties' sign-off, program-lead approval, and
> the contract-change merge path. Implementation tracking: issue #92.

## Purpose

The governing contract between **command-steering** (owner of the one program-wide
command-pattern matcher, per [D-011](../DECISIONS.md)) and the **ratification layer**
(owner of the changeset carrier and frontmatter schema). It fixes the seam their canons
already agree on, so neither can drift it unilaterally. Normative detail lives in the
owning canons; this document names what is contractual and who owns each side.

## The relationship, in one paragraph

**Steering owns match semantics; ratification carries references to them.** The changeset
frontmatter's `commandPattern` field transports a pattern plus a version pin naming the
matcher semantics it was authored against; ratification validates that field
syntactically and never evaluates, reimplements, or interprets matching. Satisfiability
of a pin — and every match outcome — is steering's, decided by exactly one matcher that
steering versions under a semver compatibility contract. Every consumer of the field
(ratification CI, steering's hook, the judge's shape-lookup at M2) fails closed on a pin
the local matcher cannot honor.

## Contract surfaces

### 1. The `commandPattern` field (ratification carries, steering defines semantics)

Per the #92 agreement and the matcher spec §2:

```yaml
commandPattern:
  pattern: "<RegExp source, steering's dialect>"
  matcherVersion: "<semver>"
```

- Object shape with **both sub-fields required when present**; per-pattern pinning (never
  once-per-changeset), so a changeset is self-describing and a matcher upgrade never
  silently re-interprets an old pattern.
- Ratification validates `pattern` as a non-empty string and `matcherVersion` as
  **syntactic semver only** (shipped: `plugins/ratification/src/frontmatter-schema.ts`).
  Match semantics and satisfiability are steering's — reimplementation anywhere is a
  D-011 violation.

### 2. Versioning (steering owns)

The matcher carries a semver semantics version sourced from one package constant (never a
hardcoded literal). Major = outcome-changing; minor = additive; patch = outcome-preserving
(matcher spec §3). **Only humans loosen**: a bump that widens matching rides a
human-ratified changeset; tightening may be proposed unilaterally. Changing semantics
without bumping the version is the same defect class as editing sealed content without
voiding the seal.

### 3. Satisfiability + fail-closed on skew (each consumer, per matcher spec §4)

- **Ratification CI** (validation time): a changeset pinning a version the local matcher
  cannot satisfy is **rejected** — build red, back to the human flow. This is a distinct
  **semantic** check, downstream of the syntactic frontmatter check, and it activates once
  surface §4 below exists (until then, syntactic-only is the contract-compliant interim —
  the ratification PM's sign-off records this sequencing).
- **Steering's hook** (runtime): a registration with an unsatisfiable pin degrades that
  entry to `ask`.
- **The judge** (read time, M2): does not apply the ruling; the command degrades to the
  normal flow.

Never a silent match, never a silent pass — the program's first invariant at this seam.

### 4. The active-version surface (steering exposes, ratification consumes)

Steering exposes its active matcher semantics version via a CLI read and a stable file
location, both sourced from the same package constant (matcher spec §5). The ratification
porcelain (`ratify propose`, #88) reads it at propose time and stamps
`commandPattern.matcherVersion`, so the pin records the semantics the pattern was
actually evaluated under. The surface is read-only for consumers and covered by the same
no-breaking-without-versioned-migration discipline as steering's telemetry contract.

## Invariants this contract inherits

- Fail closed to asking (unsatisfiable pin, malformed pattern, unknown version →
  human-approval flow; never silent).
- Only humans loosen (widening version bumps are human-ratified).
- Approval is content-addressed (the pin binds exact semantics; the sealed changeset binds
  exact content).
- One matcher (D-011): no consumer reimplements matching, ever.

## Related

- Owning canons: [command-pattern-matcher](../../command-steering/command-pattern-matcher.md)
  (semantics, versioning, surfaces), [frontmatter-schema](../../ratification/frontmatter-schema.md)
  (the carrier field), [ci-validation-contract](../../ratification/ci-validation-contract.md)
  (where the satisfiability check lands).
- Agreement record: issue #92 (field shape), PR #97 (spec + ratification PM's itemized
  sign-off on §2/§4/§5), PR #99 (shipped syntactic validation).
- Rulings: [D-011](../DECISIONS.md) (one matcher), [D-010](../DECISIONS.md) (the
  reconciler context the porcelain operates in).
