# Program decision log

Cross-project decisions made by the program lead (or ratified by Mike where they change canon
direction). One entry per decision, newest first. Line-PM decisions inside a single canon's
scope do **not** belong here — they live in that canon.

---

## D-014 · 2026-07-19 · Line PMs run as dedicated sessions, never as teammate sub-agents

Ruled by Mike (on program-lead recommendation). The rule: **peer roles get sessions;
subordinate task-work gets teammate/sub-agents.** A line PM is a peer — it holds distinct
authority and must be able to check the program lead structurally — so every line PM runs
as its own dedicated session, launched from its charter and resumed from its tracking
issue. Teammate sub-agents remain correct for work that is a means to its parent's end
(monitors, explorers, reviewers, fleet implementers), inside the parent's trust domain.

Rationale, from the first day's evidence and the program's own principles: (1) trust
domain — a teammate shares the parent session's permissions, credentials, and identity;
the agent-type-harnesses thesis requires each role to get its own harness and environment,
and the judge in particular is context-starved by design with its own signing identity;
(2) lifecycle — teammates die with the parent session and consume its context, fighting
"sessions are disposable, roles are not"; (3) capability — sub-agents cannot run their own
background monitors or orchestration loops; (4) drift — the only state-sync confusions of
day one occurred in the fast messaging side-channel, while durable-surface coordination
never drifted. Session separation also enables **per-role model tiering**: line PMs on a
mid-tier model, the program lead on a frontier model — differentiation via harness, not
just prompt, per the agent-type-harnesses brief. The steering and ratification PMs
(bootstrapped as teammates at M0 kickoff) migrate to dedicated sessions at their next
convenient stopping point; the continuity discipline makes the migration free by
construction. The PM roster thereby becomes directly adoptable as the first agent-type
harness roster at M2.

## D-013 · 2026-07-19 · Judge PM stood up early, canon-first; runtime gate unchanged

Ruled by Mike (on program-lead recommendation): the judge PM stands up ahead of the M2
gate, scoped to **canon-first** work — authoring `docs/judge/` (intent-document format,
triage policy with the ratified probation posture, crystallization flow, identity design,
risk vocabulary) and answering the ratification frontmatter schema's judge-addressed open
questions (`ratificationStatus`, `intentRef` serialization, `riskLevel`, body-template
ownership), which were blocking that schema's path to ratification. **The M2 gate itself
is unchanged**: no runtime judge (hook wiring, adjudicator implementation, live triage)
until steering's verdict-payload schema ratifies, the adjudicator-affordance contract
exists, and the identity-custody answers land (attest-it#150, vaultkeeper#261).
Implementation issues are filed `backlog` until the gate lifts. The harnesses PM remains
Phase 2 — nothing blocks on it, and it wants the config-monorepo≟harness-source ruling
first. Corollary convention fix: GitHub caps pinned issues at 3, so tracking issues are
canonical by **label query** (`program` + `plugin: <name>`, title "<project>: program
tracking"), with pinning best-effort only. Judge tracking issue: #98.

## D-012 · 2026-07-19 · Monorepo invariant affirmed; config surfaces live in one repo

Records the ratification canon's resolution of the changeset brief's critical decision,
following the brief's own stated lean: the config monorepo is **a real single repo** — one
changeset root, packages per config surface — preserving the one-to-one invariant rather
than accepting multiple changeset roots (losing the unified log) or building an aggregation
layer. Resolved in `docs/ratification/bootstrap-flow.md` §"The monorepo invariant" (PR #84);
recorded here because the brief flagged it as a critical decision. Any future multi-repo
pressure on this invariant is a program escalation, not a workaround.

## D-011 · 2026-07-19 · One command matcher: steering owns it, everyone else consumes it

Escalated by the ratification PM (frontmatter schema's `commandPattern` field). Ruling:
there is exactly **one command-pattern match semantics in the program, owned by
command-steering** — the same matcher that evaluates `covers` patterns at runtime. The
changeset frontmatter's `commandPattern`, the judge's "have I ruled on this shape?" lookup
(M2), and steering's hook evaluation all use it; a parallel matcher would let "the rule
exists" and "the rule fires" diverge, which is exactly the class of drift the program
exists to prevent. Consequences: steering documents the matcher's semantics as a versioned
contract surface (its canon; add to the future steering↔ratification contract when the
schema ratifies); ratification's schema references it by version rather than defining any
matching itself; #85 may proceed on the stable field set with `commandPattern` validated
only syntactically until the matcher spec lands.

## D-010 · 2026-07-19 · The reconciler is a ratification-layer component

Escalated by the ratification PM; the changeset brief and how-the-pieces-fit both left
placement open. Ruling: **the reconciler lives in the ratification layer** — one
deterministic applier shipped with the layer, not per-consumer pullers. Rationale: the
monorepo invariant promises *one atomic decision, one merge*; atomicity must survive past
merge into apply, and N independent consumer pullers reintroduce exactly the half-applied
states the invariant forbids (tool landed, rule didn't). One applier is also one audited,
one-version code path — the same argument as the porcelain tool. Consumers stay
**declarative**: each config-surface package carries an apply manifest (what goes where,
what bits flip, what validations run); the reconciler executes manifests, consumers never
execute themselves. The requirements already stated in
`docs/ratification/bootstrap-flow.md` §"The reconciler seam" (reads only ratified `main`;
deterministic + idempotent; fails closed, never partially applies) are ratified as binding.
Manifest format is ratification-PM scope; anything a manifest asks the reconciler to do
that widens capability still rides a human-ratified changeset (only humans loosen).

## D-009 · 2026-07-19 · Decider routing labels supplement `needs-decision`

Refines D-006 (prompted by Mike): the decider is named by **label**, not body text —
`decider: program-lead` and `decider: mike` applied alongside bare `needs-decision`.
Bare `needs-decision` stays the pickup-blocker (fleet tooling and cross-repo conventions
key on that exact label); the decider labels make each escalation queue a one-line label
query instead of a read-every-issue scan. Line-PM-decided questions carry no decider label
— that's the default tier and never escalates. Labels are removed when the decision lands.

## D-008 · 2026-07-19 · Merge authority delegated for docs/specs; runtime code stays with Mike

Ruled by Mike: the program lead is the **reviewer and merger of product spec/definition
changes made by line PMs** — canon docs, contracts, charters, roadmaps, and
fleet-convention docs. This is a duty, not just an authority: line-PM canon PRs get a
substantive program-lead review (boundary leaks, invariant violations, contract
consistency, cross-project fit) and, when sound and green, a program-lead merge.
**Runtime code merges remain Mike's**, as does anything that loosens a capability (the
only-humans-loosen invariant is unchanged — the delegation covers documentation of intent,
not activation of behavior). A PR mixing docs and runtime code is not mergeable under this
delegation: request a split or route it to Mike. Amends the README's "canon merges are the
only human gate" line: canon merges remain the ratification mechanism; for pure docs/spec
canon, the program lead now performs them.

**The escalation line — elaboration vs. direction.** The program lead merges what
*elaborates within ratified direction*; anything that *changes direction* escalates to
Mike, even when it's pure docs. Concretely:

*Program lead merges:* canon skeletons and specs that detail ratified briefs (schemas,
contract elaboration, telemetry formats, CI check definitions); charter/process/roadmap
edits that don't alter what Mike ratified; contract changes signed off by all party PMs
that stay inside the ratified architecture; editorial and consistency fixes.

*Escalates to Mike (his merge):* changes to **product principles** (the three invariants,
the composability thesis, fail-closed posture, the razor); changes to **technical
direction** (dependency-graph direction, adding/removing/merging products, relocating a
seam, trust-domain or identity-model changes); anything **loosening a capability or
weakening a gate**; **roadmap changes to ratified sequencing gates** (as opposed to
reflowing work within them); anything marked `[NEEDS INPUT — Mike]` (e.g. naming, D-007);
and **all runtime code**. When genuinely unsure which side of the line a change sits on,
it escalates — the same fail-closed default the products themselves follow.

## D-007 · 2026-07-19 · Naming pass pending

`[NEEDS INPUT — Mike]` All project names except attest-it are working names: *command
steering*, *the judge*, *ratification* (the changeset layer), *harnesses*. A deliberate
naming pass is owed before anything publishes externally. Until then, working names are used
consistently everywhere (labels, canons, charters) so the eventual rename is mechanical.

## D-006 · 2026-07-19 · Decision routing tiers

Three tiers, one label. `needs-decision` blocks pickup; the issue names the decider. Line PM
decides within ratified canon scope; program lead decides cross-project questions (recorded
here); Mike decides only canon-direction changes, and his decision *is* the canon PR merge.
Rationale: keeps the human gate at maximum leverage (canon merges only, per Mike's explicit
choice) while making every other decision's owner unambiguous.

## D-005 · 2026-07-19 · Contracts are canon documents, not issues

Cross-project agreements live in `contracts/`, versioned and governing. Issues reference
them; they don't carry them (issues close, contracts live). The steering↔toolsmith contract
drafted in issue #71 is promoted to
[contracts/steering-toolsmith.md](./contracts/steering-toolsmith.md); #71 remains open as the
implementation tracking issue. Contract changes need every party PM's sign-off + program-lead
approval + Mike's merge.

## D-004 · 2026-07-19 · Issues #71–77 adopted, not re-derived

The pre-existing contract issue and six scoped tickets are ratified as the M1 backlog:
#72–74 → `plugin: command-steering`, #75–77 → `plugin: toolsmith`, #71 → `contract` +
`program`. Dispositions #71 states for older issues are executed (#44 superseded by the
integrity-pin fail-closed mechanism; #37/#40/#41/#42/#61 steering-bound work moves to the
steering label).

## D-003 · 2026-07-19 · Runtime repos are byproducts of using the products

The config monorepo and materialized harness roots are **created by bootstrap/init flows of
the ratification and harnesses plugins**, never hand-scaffolded by the program. `ai-plugins`
holds products (plugins, canons); runtime state appears where users run them. Consequence:
"bootstrap flow" is a first-class product requirement in the ratification and harnesses
charters. (Ruled by Mike, 2026-07-19.)

## D-002 · 2026-07-19 · Repo topology: everything in ai-plugins

All new products (command-steering, judge, ratification, harnesses) live in this repo as
plugins/packages with `docs/<project>/` canons, following the toolsmith precedent — one
fleet, one queue, `plugin: <name>` labels. Chosen over new-repo-per-project to avoid 4+ new
queues and orchestration surfaces while the products are young. Revisit if a product needs an
independent release cadence or external contributors. (Ruled by Mike, 2026-07-19.)

## D-001 · 2026-07-19 · The judge is a separate product with its own PM, staged to Phase 2

`command-judge` is not folded into `command-steering`. The dependency is deliberately
one-way (judge consumes steering's adjudicator affordance; steering knows nothing of the
judge); the disciplines differ (deterministic policy engine + pattern-matching accuracy vs.
reasoning agent + intent constitution + signing identity); and the system must degrade
gracefully with the judge removed — a seam a single PM would erode. The judge PM stands up in
Phase 2, after steering ratifies the verdict-payload schema and adjudicator affordance; until
then the steering PM holds those two specs. Corollary: the
[bash-command-safety-analysis](./bash-command-safety-analysis.md) input splits along the same
seam (deterministic core → steering; learning loop / trust asymmetry / provenance → judge).
