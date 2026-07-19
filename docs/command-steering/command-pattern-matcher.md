# Command steering: the command-pattern matcher (versioned contract surface)

> **Status**: **draft** (issue #95 Part A; ruling [D-011](../harness-program/DECISIONS.md)). Establishes
> the one program-wide command-pattern match semantics and its versioning contract as a proposal;
> becomes governing when this PR is merged to `main`. The **version-reference mechanics** in §4–§5
> graduate into a `steering ↔ ratification` contract doc when ratification's frontmatter schema
> ratifies (both-PM sign-off + program-lead approval + Mike's merge — not authored unilaterally here).

## Why this exists (D-011)

There is exactly **one command-pattern match semantics in the harness program, owned by
command-steering** — the same matcher that evaluates `covers` patterns at runtime. Three consumers
reference it, none reimplements it:

- **steering's own hook** — evaluates `covers` / watchlist / rule patterns against the command being
  attempted (the redirect and soft-block legs of [architecture-steer](./architecture-steer.md)).
- **ratification's changeset frontmatter** — the `commandPattern` field a judge-proposed rule carries
  (the changeset layer / ratification canon).
- **the judge's shape-lookup** (M2) — "have I already ruled on a command of this shape?"

A parallel matcher would let *"the rule exists"* and *"the rule fires"* diverge — exactly the drift
class the program exists to prevent. So the semantics live in one place, are **versioned**, and every
consumer pins the version it was authored/evaluated against.

## §1 — What the matcher does (the match semantics)

The matcher is a pure, deterministic function:

```
match(command: string, pattern: CommandPattern) -> { matched: boolean, captures: Record<string, string> }
```

- **Input** — a raw command string (the leading command of a Bash tool call) and a `CommandPattern`.
- **Output** — whether the pattern matches, plus any **named captures** extracted from the command.
- **No side effects, no I/O, no throw.** Compilation and testing reuse the shipped never-throw
  discipline (`toRegExp` / `safeTest` in `plugins/toolsmith/scripts/toolsmith-check.mjs`): a malformed
  pattern compiles to "never matches", it never crashes the hook or the validator.

A `CommandPattern` is the `covers`-pattern shape already shipped, extended per the parameterized-steering
design ([steering-adjudication](../toolsmith/steering-adjudication.md) Tier 1):

- a **JavaScript RegExp source string** tested against the raw command;
- optional **named capture groups** (`(?<repo>…)`), each declared with a **narrow character class**,
  never `.+` — a capture is attacker-adjacent input (it comes from a command an agent constructed,
  possibly downstream of injected content) that gets echoed into a suggested `filledInvocation`;
- **render-time capture validation**: each captured value is re-checked against its declared class
  before it is used, independent of whether the pattern matched at detection time.

The semantics that a version pins (§3) are precisely: the **regex dialect** accepted, the
**capture-class vocabulary** and its validation, the **anchoring/tokenization rules** (including
wrapper-aware equivalence such as the `gh_dotcom`/`gh` class), and the **never-throw fallback**
behavior. What the matcher deliberately does **not** decide is whether a matched command is *safe* —
that is the verdict engine's job (the leg tables in [architecture-steer](./architecture-steer.md)),
not the matcher's.

### Relationship to the bash static-analysis core

The [bash-command-safety-analysis](../harness-program/bash-command-safety-analysis.md) core (real
shell-grammar parse, leaf enumeration, dynamic-construct bail) **bounds what a pattern is allowed to
match against**: a pattern is tested against enumerated leaf commands, and a command carrying a
dynamic construct (`eval`, command substitution in command position, unquoted expansion in program
position, or a `PATH`/`IFS`/`LD_PRELOAD`/`BASH_ENV` set) **bails to fail-closed before matching** — you
cannot pattern-match your way to a match on a command whose reachable behavior can't be statically
bounded. The depth of that integration is implementation (#95 Part B, near #73/#74); this contract
fixes that the bail is part of the versioned semantics, so a consumer pinning version *vX* knows which
bail rules were in force.

## §2 — The `CommandPattern` shape and the `commandPattern` field

Ratification's changeset frontmatter carries the field as an **object** (agreed with the ratification
PM; their #92, this canon's #95):

```yaml
commandPattern:
  pattern: "gh\\s+api\\b.*repos/(?<repo>[\\w.-]+/[\\w.-]+)/pulls/(?<pr>\\d+)/comments"
  matcherVersion: "1.0.0"
```

- `pattern` — the RegExp source (§1). Validated **syntactically** by ratification (well-formed
  frontmatter); its *match semantics* are steering's, evaluated only by the one matcher.
- `matcherVersion` — a **semver string** naming the matcher semantics the pattern was authored and
  evaluated against. Per-pattern (not pinned once per changeset) so a changeset is **self-describing**
  and a matcher upgrade never silently re-interprets an old pattern. Ratification validates it
  syntactically; **satisfiability is steering's** (§4), never reimplemented in ratification.

## §3 — Versioning and the compatibility contract

The matcher carries a **semver semantics version**, sourced from one constant in the steering package
(never a hardcoded literal — the reported version must track the released semantics or diagnosis
breaks). What each level means for *match outcomes*:

| Bump | Meaning | Effect on a pinned consumer |
|---|---|---|
| **major** | A change that can alter the `matched`/`captures` result of an existing pattern (dialect change, anchoring change, a bail rule that now fires). | A pattern pinned to an older major is **not satisfiable** by a newer major without re-authoring — fail closed (§4). |
| **minor** | Additive: new capture classes, new wrapper equivalences, patterns using them require the new minor; existing patterns match identically. | A consumer pinning `≤` the local minor is satisfiable. |
| **patch** | A fix that does not change any documented match outcome. | Always satisfiable within the same major. |

**Only humans loosen.** A version bump that *widens* what patterns can match (a new wrapper
equivalence, a looser capture class) is a capability change and rides a **human-ratified changeset**
through the shared flow — it is never a silent library update. A bump that *tightens* (a new bail
rule, a narrower class) may be proposed unilaterally, because tightening degrades safely to asking.

**Approval is content-addressed.** A `matcherVersion` binds the exact semantics a pattern was
evaluated against; changing the semantics without changing the version is the same defect class as
changing a signed file without voiding its seal.

## §4 — The consumer version-reference model (satisfiability + fail-closed)

Every consumer that evaluates or validates a `commandPattern` performs a **satisfiability check**
against the local matcher's version before trusting a match:

- **Satisfiable** — the local matcher can evaluate the pinned semantics (same major, local minor `≥`
  pinned minor). The match proceeds.
- **Unsatisfiable** — the pin names a version the local matcher cannot honor (newer major, or newer
  minor than local). The consumer **fails closed**:
  - **ratification CI** (validation time): the changeset is **rejected** — frontmatter/semantic check
    red → the normal human flow. Mirrors ratification's existing "unknown `schemaVersion` major → fail
    closed."
  - **the judge** (read time, M2): does **not** apply the rule — degrades to asking, never matches
    under guessed semantics.
  - **steering's hook** (runtime): a registration whose `matcherVersion` the running matcher can't
    satisfy degrades that entry to **`ask`** (the cross-project fail-closed invariant), never a silent
    match or silent pass.

Fail-closed on version skew is the matcher-level expression of the program's first invariant: an
unresolvable or unknown matcher version is an ambiguity, and every ambiguity degrades to the human.

## §5 — The active-version surface (propose-time stamping)

For a judge-authored changeset to pin the semantics it was **actually evaluated against**, the tool
that composes the changeset must be able to read steering's *current* matcher version at **propose
time**. Steering therefore exposes its active matcher semantics version through a **stable, documented
surface**:

- a **CLI read** — a `matcher --version`-style verb on the steering CLI that prints the active
  semantics version, and
- the **same value at a stable file location** under the steering config dir, refreshed by the
  engine,

both sourced from the **one package constant** (no hardcoded literal; the two surfaces can never
disagree because they read the same source). The ratification porcelain tool (#88) reads this surface
when composing a changeset and stamps the value into `commandPattern.matcherVersion`, so the pin
records the semantics the pattern was evaluated under — not whatever the fleet later upgrades to.

This surface is **read-only** for consumers and covered by the same stability discipline as the
telemetry contract ([telemetry-schema](./telemetry-schema.md) §reader contract): steering must not
change the surface's shape or location without a versioned migration readers can detect.

## §6 — Invariants (each independently testable)

1. **Fail closed to asking.** An unknown or unsatisfiable `matcherVersion`, a malformed pattern, or a
   command that bails the static-analysis core degrades to the human-approval flow — never a silent
   match, never a silent pass.
2. **Only humans loosen.** A version bump that widens matching rides a human-ratified changeset;
   tightening may be unilateral.
3. **Approval is content-addressed.** A pinned `matcherVersion` binds exact semantics; changing
   semantics without bumping the version is a defect.
4. **One matcher.** No consumer (ratification, the judge) reimplements matching; all reference this
   one matcher by version. A parallel implementation anywhere is a D-011 violation.
5. **No hardcoded version.** The reported matcher version is sourced from the package constant, and a
   test asserts the reported value equals that source (not a literal).

## §7 — Scope: what this fixes, what it defers

**Fixes** (this contract surface): the match-function signature, the `CommandPattern`/`commandPattern`
shape, the semver compatibility contract, the consumer satisfiability + fail-closed model, and the
active-version surface for propose-time stamping.

**Defers to implementation** (#95 Part B, near #73/#74 where the engine is extracted): the concrete
regex dialect enumeration; the capture-class vocabulary's initial members; the depth of the
bash-static-analysis integration; and the initial released semantics version (`1.0.0` at first stable
extraction, sourced from the package). The extraction (#74) ports the shipped `covers` matcher as the
`1.0.0` baseline; this doc is the contract that baseline and every later version must honor.

**Non-goals**: deciding command *safety* (the verdict engine's job, not the matcher's); the changeset
frontmatter schema itself (ratification's #85); and the signing/ratification ceremony (the changeset
layer + attest-it).
