# Program decision log

Cross-project decisions made by the program lead (or ratified by Mike where they change canon
direction). One entry per decision, newest first. Line-PM decisions inside a single canon's
scope do **not** belong here — they live in that canon.

---

## D-017 · 2026-07-20 · The nudge tier: adopted as direction; seam ruled; five binding rules

Rules issue #128 (proposal from Mike, worked through with the judge PM). The **nudge
tier** — the judge returning an agent-addressed response on ask-set commands it would
otherwise pass through: cost stated, permitted alternatives named, decomposition
suggested, and terms for coming back with a rationale that rides to the human — is
**adopted as ratified design direction**. Nothing is authorized to build yet; runtime
remains M2-gated. It needs no probation exception: a nudge is a block that teaches,
improving the block side without touching the forbidden allow side.

**The seam (Q1).** Split by the D-001 one-way dependency, neither line specifying the
other's work:

- **Judge canon** owns nudge *policy*: when to nudge, the content obligations
  (alternatives, decomposition, return terms), the retry bound, and the
  insufficiency-report format.
- **Steering canon** owns *shape and emission* — and already does: the nudge is the
  existing soft-block leg (`deny`, model-audience reason) with a new producer;
  `provenance.source: "adjudicator"` already distinguishes it, so the wire shape likely
  changes not at all. The proceed-token UX and the rationale carrier are steering's.
- **The cross-surface rules land in the adjudicator-affordance contract**
  (`contracts/steering-judge.md`), drafted when steering hands the affordance spec over at
  M2 per D-001; #128's content is that contract's first reserved section. Until the
  contract exists, neither line implements the tier.

**Five binding rules, ratified now** (violating any is a defect regardless of local
merit):

1. **Rationale never re-enters adjudication and never converts a nudge into any allow.**
   It is carried to the human, redacted but otherwise unedited. A persuasive explanation
   must buy exactly nothing from the machine — otherwise we have built a channel that
   teaches agents to write explanations, and desperation gets the door context starvation
   closed (only-humans-loosen, at the tier's core).
2. **At most one nudge per command shape per session; the second pass reaches the human
   regardless.** Honest use of the offered return path is provided-not-discovered (intent
   v1, `approval-gates-are-load-bearing` clause 4); laundering near-variations through it
   is the §3.2 desperation signature and is treated as such.
3. **A suggested alternative must be verifiably permitted at suggestion time.** A wrong
   redirect is worse than none (steering's own core principle); the judge never guesses an
   affordance into existence.
4. **The rationale carrier must not break content-addressed grants or matcher semantics.**
   Annotating the command string changes its hash and what the matcher sees; the carrier
   design is steering's under D-011, and inline-comment annotation is presumptively wrong
   until steering rules otherwise.
5. **The redaction discipline extends to rationale text** on every persisted surface
   (adjudication context, telemetry, any changeset field) — agent-authored rationale is
   credential-bearing plaintext until proven otherwise, same as `triggeringObservation`.

**Q2 (naming)**: the judge PM's axis is endorsed — tiers order *addressee and cost*
(agent-addressed/recoverable → human-addressed/attention-consuming → terminal), never
linter-style severity. Final names ride the D-007 naming pass. **Q6 (alternative
discovery)**: what the judge may read (package scripts, toolsmith registry, permission
config) is a capability-floor question answered by the judge's harness definition at M2,
coordinated with the harnesses line; design may assume read-only affordance access subject
to that spec. **The insufficiency-report feedback loop** (reports of "why the safe
alternatives were insufficient" as a tool-forging queue) is endorsed as direction — it is
the safety analysis's two-speed loop arriving in structured form — and lands as a
toolsmith↔judge touchpoint designed no earlier than M2.

## D-016 · 2026-07-19 · Dedicated code-review role; merge-authority matrix amended

Ruled by Mike. A dedicated **code-review agent** joins the program (own session per
D-014; charter: [code-reviewer](./charters/code-reviewer.md)), holding a high quality bar
over all code in this repo. The merge-authority matrix (amending D-008):

| PR contents | Reviewer | Merger |
|---|---|---|
| **Pure code** (no product-centric artifacts) | code-review agent | **code-review agent**, when its bar is met |
| **Mixed** (code + product-centric artifacts) | code-review agent (code) + program lead (product) | **program lead**, accountable that every code change passed the code-review agent and all its feedback is addressed before merge |
| **Pure product/spec docs** | program lead | program lead (D-008, unchanged) |
| **Anything capability-loosening, direction-changing, or `[NEEDS INPUT — Mike]`** | as above, plus escalation | **Mike**, always — this row overrides every other row |

**Product-centric artifacts** are: everything under `docs/` (canons, contracts, charters,
ROADMAP, DECISIONS, intent documents), `ENG_TEAM_INSTRUCTIONS.md`, and plugin/marketplace
manifests that change an agent-facing surface's declared behavior. In-package code READMEs
and code comments are code, not product artifacts. When classification is genuinely
unclear, the PR is treated as mixed — fail toward the more-gated row.

The only-humans-loosen invariant is untouched: no agent row ever merges a capability
loosening; the last row is absolute. Consequence for in-flight work: PR #99 (pure runtime
code) re-routes from Mike's queue to the code-review agent's.

## D-015 · 2026-07-19 · The config monorepo IS the harness layered-source repo

Ruled by the program lead (the ruling the roadmap assigned "before M2"; fulfills, not
alters, that gate). **One repo**: the config monorepo that `ratify init` creates is also
the agent-type-harnesses layered-source repo — `main` holds the layered, human-reviewed
source (config-surface changeset packages *and* harness layer definitions); materialized
branch(es) hold the flattened per-agent-type artifacts the launcher points at.

Rationale: (1) harness-layer changes **are** config decisions — a base-CLAUDE.md edit or a
role-permission change is exactly the class of thing the ratification ceremony exists for;
a second repo would mean a second ratification surface and a split decision log,
contradicting the unified-log preference D-012 just affirmed. (2) The changeset monorepo
invariant (one atomic decision, one merge) extends naturally: a decision spanning a
steering rule and a harness layer is one changeset, one merge. (3) Ratification's
bootstrap layout was explicitly designed not to foreclose this
(`docs/ratification/bootstrap-flow.md` §"The M2 gate question"), so the cost is near zero
now and grows if deferred. (4) The materialized branches carry **no changesets and no
canon** — they are build artifacts (the materializer's output, per the agent-type-harnesses
brief's source-vs-artifact split), so they cannot pollute the decision log.

Consequences: harness layer definitions join the config monorepo as packages (layout
detail is the harnesses PM's on stand-up); the materializer reads `main`, writes
materialized branches, and is a *distinct* deterministic transform from D-010's reconciler
(reconciler applies ratified config to the live system; materializer flattens layers into
harness roots — same repo, different outputs; whether they share machinery is a harnesses↔
ratification design conversation, not presumed here). The harnesses PM's stand-up gate is
now only: ratification flow usable + Mike's launch. Escape hatch: if materialization or
harness-source volume measurably degrades the changeset log's usability as the judge's
memory, that is a program escalation to revisit — not a quiet workaround.

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
