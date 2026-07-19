# Command steering: the telemetry triangle

> **Status**: **draft** (steering ↔ toolsmith [contract §5](../harness-program/contracts/steering-toolsmith.md)).
> This document is the forward-looking home for steering's telemetry contract. The verdict-log leg's
> field-level detail currently lives in `docs/toolsmith/steering-spec.md` §2 (PR #67) and
> **transfers here** on merge per the contract's Related note; this draft states the triangle as a
> whole and the reader contract, and defers to §2 for the verdict-log field schema until the transfer
> lands rather than restating (and risking divergence from) it. Becomes governing when Mike merges.

Steering owns the telemetry triangle. It is **local, load-bearing product surface** — the substrate
the toolsmith curator (and later the judge) reads to propose tools and crystallize rules — **not
analytics**. This document specifies what the three legs are, where each lives, and the read-only
stability contract consumers depend on.

## The three legs

The "triangle" is three record streams that together answer _what ran_, _what got redirected_, and
_what got asked_ (program brief, "Telemetry"; `architecture-steer.md:49`):

| Leg | Records | Written by | Location |
|---|---|---|---|
| **Invocations + outputs** | one line per Bash call that ran, and its output | PostToolUse hook | `<projectRoot>/.claude/toolsmith/history.jsonl` (existing) |
| **Redirects + asks** | one line per **steering decision** the pre-hook made (redirect, soft-block, tamper/integrity, ask-cost) | PreToolUse hook (node brain) | `<projectRoot>/.claude/toolsmith/steering.jsonl` |
| **Grants + provenance** | which grant/registration authorized a defer | derived, not a separate file — carried in the verdict log's `provenance` and the registry | registry + verdict log |

The load-bearing distinction: the verdict log is a **verdict log, not a command log**. `history.jsonl`
already records what _ran_ (the PostToolUse leg); `steering.jsonl` records only the decisions the
pre-hook actually _made_, and nothing on the defer/pass-through path. A command steering lets through
untouched is not a steering event and is not logged here. This keeps the log small, keeps the
not-opted-in hot path write-free, and makes redirect volume — the semantic-activation defect signal —
directly countable.

## Verdict-log field schema (transfers from steering-spec §2)

Until PR #67's `steering-spec.md` §2 transfers into this canon, its field schema is the normative
source and is **not restated here** to avoid a divergent second copy. Its load-bearing properties,
recorded so this doc stands alone as a pointer:

- **Format**: NDJSON, one object per steering event; UTC `%Y-%m-%dT%H:%M:%SZ` timestamps, matching
  `toolsmith-log.sh`.
- **Rotation**: `> 2000` lines → retain the most recent 1500 (`toolsmith-log.sh`'s exact policy).
- **Self-gitignore**: the hook writes/refreshes `.claude/toolsmith/.gitignore` with a `steering.jsonl`
  line.
- **Write posture**: best-effort; a write failure **never** changes the verdict and emits no stderr
  (#39 AC4). Recording telemetry can never change a permission decision — the fail-closed invariant
  extends to the logger.
- **Fields** (per §2): `ts`, `verdict` (`redirect | soft-block | tamper | ask-cost`), `command`,
  `tool` (or null), `reason` (a short machine-stable slug, not the human prose).
- **Plaintext-secret hazard**: `command` may embed credentials (`-H "Authorization: Bearer …"`); the
  file is local and gitignored but plaintext. `.claude/toolsmith/` is sensitive and must not be copied
  elsewhere — the `registry-schema.md` secret warning applies verbatim.

**Cross-reference for the transfer**: the verdict-log `verdict` slugs and the
[verdict-payload](./verdict-payload-schema.md) `leg` values name the same events and must not drift.
On transfer, reconcile the two vocabularies (payload `leg`: `redirect | soft-block | ask-cost |
integrity | grant`; log `verdict`: `redirect | soft-block | tamper | ask-cost`) into one table — the
log's `tamper` is the payload's `integrity` leg, and the `grant` leg defers (no log line). This
reconciliation is the one net-new specification work the transfer owes; everything else is a move.

## The reader contract (§5)

Consumers read the telemetry triangle; steering writes it. The contract:

1. **Read-only for consumers.** The toolsmith curator / `analyze` reads the logs to propose tools and
   the judge (Phase 2) reads them to triage and crystallize; neither writes them. Steering is the sole
   writer of `steering.jsonl`.
2. **Stable, documented schema + location.** The field schema and file paths above are the contract
   surface. Consumers may depend on them.
3. **No breaking a reader without a versioned change.** Steering must not rename a field, change a
   type, or move a file without a versioned migration that readers can detect — the same discipline
   contract §5 states. A schema bump is a canon change ratified through the shared flow, not a silent
   edit.
4. **Cross-project rollup is the consumer's job, not a new log.** The logs are project-local (like
   `history.jsonl`); there is no user-level aggregate log. `toolsmith analyze` rolls up across projects
   via the user-level project index — steering does not grow a second, wider log to serve it.

## What this is not

- **Not analytics or metrics export.** No dashboards, no external sink; the triangle exists to feed
  the curator and the judge locally.
- **Not a success scoreboard.** Redirect volume is a _defect signal_ — rising redirects mean agents
  are finding the raw command before the safe target, a curation problem to fix. Any reader treating a
  high redirect count as success has misread the contract.
- **Not a command audit log.** `history.jsonl` is the record of what ran; `steering.jsonl` is the
  record of what steering _decided_. Conflating them reintroduces the write-on-every-call tax the
  hot-path budget forbids.
