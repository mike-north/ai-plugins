# Toolsmith canon

Design canon for the **toolsmith** plugin — agents propose their own narrow tools; humans sign them
once; grants scope them to agent types; a lifecycle graduates them to autonomy. These documents
govern the fleet issues labeled `plugin: toolsmith`; where an issue and this canon disagree, **the
canon wins until amended** (`ENG_TEAM_INSTRUCTIONS.md` §Governance).

The program-level brief this canon serves is
[Toolsmith, narrowed](../harness-program/toolsmith-narrowed.md); the cross-project agreement it is
party to is the [steering ↔ toolsmith contract](../harness-program/contracts/steering-toolsmith.md).
This canon may sharpen and specify, but never contradict, those two — a contradiction is an
escalation to the program lead, not a local edit (see the charter,
[`toolsmith-pm`](../harness-program/charters/toolsmith-pm.md)).

## ⚠️ Read this first: the canon predates the narrowing

Most documents here were written **before** toolsmith's scope was narrowed
([toolsmith-narrowed](../harness-program/toolsmith-narrowed.md), adopted 2026-07-19). They remain
"the reference for everything that stays" — but several contain sections describing **command
steering**, which has left toolsmith's scope entirely. Those sections are **historical context, not
governing toolsmith canon**; the governing home is [`docs/command-steering/`](../command-steering/).

A reader who takes `architecture-steer.md`'s "Hooks: steer, don't block" as a statement of what
toolsmith does today will be wrong. The table below is authoritative about which is which.

## The map

| Document | Status for toolsmith | Notes |
|---|---|---|
| [staged-live-split](./staged-live-split.md) | **Governing, current** | The staged/live state machine, write-denial layers, promotion apply manifest. Written post-narrowing (#75). |
| [attest-it-admission](./attest-it-admission.md) | **Governing when merged** (#76, PR #114) | Admission as an attest-it seal over the full reviewed surface. |
| [registration-emission](./registration-emission.md) | **Draft proposal** (#77, PR #121) | Toolsmith's emission side of contract §1. Binds steering only with the steering PM's sign-off. |
| [design-patterns](./design-patterns.md) | **Governing** | Tool authoring standard: naming, config precedence, interactivity/progress rejections, timeout discipline. Unaffected by the narrowing. |
| [runtime-spec](./runtime-spec.md) | **Governing** | The forge runtime/SDK. Unaffected. |
| [lint-rule-concepts](./lint-rule-concepts.md) | **Governing** | The forge rule pack (proposal gate). Unaffected. |
| [cli-surface](./cli-surface.md) | **Governing** | The toolsmith CLI surface (`approve`, `lint`, `list`, `analyze`; `new`/`modify` deliberately not verbs). Its hook-internal `check`/`adjudicate` verbs describe steering-side concerns — see below. |
| [product-framing-and-principles](./product-framing-and-principles.md) | **Mixed** | The two approvals, the two archetypes, the role-to-authority thesis: **governing**. §"Steering principles for the hooks": **superseded** → [command-steering](../command-steering/architecture-steer.md). Note the enforcement line (`:36`) describing a hook returning `allow` on a valid grant is superseded by the contract — steering never emits `allow`. |
| [architecture-steer](./architecture-steer.md) | **Mixed** | §"The toolsmith sub-agent" (curator remit): **governing**, now shipped as `plugins/toolsmith/agents/tool-curator.md`. §"Hooks: steer, don't block" and the telemetry-triangle paragraph: **superseded** → [command-steering](../command-steering/architecture-steer.md) and [telemetry-schema](../command-steering/telemetry-schema.md). |
| [prfaq](./prfaq.md) | **Mixed** | Forging, signing, review-fatigue, and archetype answers: **governing**. Blocking/redirect and telemetry answers: **superseded** → command-steering. |
| [steering-adjudication](./steering-adjudication.md) | **Superseded in place** | Wholly command-steering's subject matter (parameterized redirects, the tier model, the adjudicator affordance). It physically lives here for now because steering's canon references it by path; relocating it is command-steering's call, tracked below. |

## Known structural wart

`steering-adjudication.md` is command-steering content sitting in toolsmith's canon directory, and
**steering's own canon references it across the boundary** (`docs/command-steering/architecture-steer.md`,
`command-pattern-matcher.md`, `verdict-payload-schema.md` all link `../toolsmith/steering-adjudication.md`).
The same applies to PR #67's steering spec, which was authored at `docs/toolsmith/steering-spec.md`
before the split and is now held in draft pending the steering PM's disposition.

This is a boundary leak in the sense the program README names ("anything true of one project lives in
that project's canon"). It is **not** toolsmith's to fix unilaterally — the content is steering's, so
relocation is their call. Flagged to the command-steering PM on PR #67; this note exists so a reader
of toolsmith canon isn't misled about ownership in the meantime.

## What is deliberately *not* here

- **Interception, redirects, cost surfacing, the verdict payload, telemetry ownership, and the
  command-pattern matcher** — all [command-steering](../command-steering/).
- **Adjudication and the intent constitution** — the judge (Phase 2).
- **Signing mechanics and the ratification ceremony** — [ratification](../ratification/) and
  attest-it (an external project the program consumes without leaking into).
- **The graduation lifecycle's thresholds** — toolsmith's by ownership
  ([charter](../harness-program/charters/toolsmith-pm.md)), but M3 work: it depends on the judge
  existing, and the brief expects it to start as a manual human call per tool before becoming policy.
