# Program decision log

Cross-project decisions made by the program lead (or ratified by Mike where they change canon
direction). One entry per decision, newest first. Line-PM decisions inside a single canon's
scope do **not** belong here — they live in that canon.

---

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
