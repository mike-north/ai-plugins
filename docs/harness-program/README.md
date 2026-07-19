# The harness program

Program-level canon for a set of composable primitives that together form a governed agent
harness: **command steering**, **the judge**, **Toolsmith (narrowed)**, **attest-it as
substrate**, **the changeset/ratification layer**, and **agent-type harnesses**. Adopted
2026-07-19 from Mike North's brainstorm drafts of 2026-07-18/19.

**Status**: ratified program canon. These documents govern the fleet issues carrying the
program's `plugin: *` labels (see roster below); where an issue and this canon disagree, the
canon wins until amended. Canon amendments are ratified by PR merge — no other ceremony
exists in this program. Per [DECISIONS D-008](./DECISIONS.md), the program lead holds merge
authority for pure docs/spec PRs; runtime-code merges, and anything that loosens a
capability, remain Mike's.

## Reading order

1. [How the pieces fit](./how-the-pieces-fit.md) — the dependency graph, shared contracts,
   ratification flow, and cross-project invariants. Start here.
2. The five project briefs, each freestanding:
   [command steering](./command-steering.md) · [the judge](./judge.md) ·
   [Toolsmith, narrowed](./toolsmith-narrowed.md) ·
   [the changeset layer](./changeset-layer.md) ·
   [attest-it as substrate](./attest-it-substrate.md)
3. [Agent-type harnesses](./agent-type-harnesses.md) — the layer above: one materialized
   harness per agent type.
4. [Bash command safety analysis](./bash-command-safety-analysis.md) — input brainstorm,
   split between steering and judge (see its header).
5. Program operating documents: [ROADMAP](./ROADMAP.md) · [DECISIONS](./DECISIONS.md) ·
   [contracts/](./contracts/) · [charters/](./charters/)

**The boundary rule** (inherited from the doc set, extended to the program): anything true of
one project lives in that project's brief/canon; anything true of a relationship lives in a
`contracts/` doc or [how-the-pieces-fit](./how-the-pieces-fit.md); anything true of how we
*work* lives here, in the charters, or in the repo's `ENG_TEAM_INSTRUCTIONS.md`. Leaks across
these boundaries are defects.

## Where things live

- **Product code and canon**: this repo (`ai-plugins`). Each product is a plugin (or package)
  plus a `docs/<project>/` canon, following the toolsmith precedent. One fleet, one issue
  queue, `plugin: <name>` labels.
- **Runtime repos are byproducts, never deliverables.** The config monorepo and materialized
  harness roots are created *by running the products* — bootstrap/init flows are product
  requirements of the ratification and harnesses plugins. The program never hand-scaffolds
  runtime state.

## The PM roster

One line PM per product, each driving an eng fleet via `product-led-eng-fleet`. The program
lead owns the seams. Charters in [charters/](./charters/).

| PM | Charter | Canon | Issue label | Status |
|---|---|---|---|---|
| Program lead | [program-lead](./charters/program-lead.md) | `docs/harness-program/` | `program` | active |
| Toolsmith | [toolsmith-pm](./charters/toolsmith-pm.md) | `docs/toolsmith/` | `plugin: toolsmith` | active |
| Command steering | [command-steering-pm](./charters/command-steering-pm.md) | `docs/command-steering/` | `plugin: command-steering` | active |
| Ratification | [ratification-pm](./charters/ratification-pm.md) | `docs/ratification/` | `plugin: ratification` | active |
| Judge | [judge-pm](./charters/judge-pm.md) | `docs/judge/` | `plugin: judge` | Phase 2 — unstaffed |
| Harnesses | [harnesses-pm](./charters/harnesses-pm.md) | `docs/harnesses/` | `plugin: harnesses` | Phase 2 — unstaffed |

All project names except attest-it are working names pending the naming pass
([DECISIONS](./DECISIONS.md) carries the `[NEEDS INPUT]`).

attest-it is deliberately **not** on the roster: it is an existing external project
(`mike-north/attest-it`) with its own maintainers. The program engages it as a stakeholder —
requests are filed as issues in its repo, and nothing program-specific may leak into it
(see [attest-it-substrate](./attest-it-substrate.md)).

## How coordination works

1. **Canon governs; issues execute.** Every fleet issue cites the canon section(s) it
   implements. No canon citation → not pickup-ready.
2. **Contracts are canon documents, not issues.** Cross-project agreements live in
   [contracts/](./contracts/). A contract change requires a PR touching the contract doc,
   sign-off from every party PM, program-lead approval, and Mike's merge. Code PRs changing a
   shared schema must link the contract revision.
3. **Decision routing.** `needs-decision` blocks pickup; the issue body names the decider:
   - **Line PM** — anything inside their canon's ratified scope.
   - **Program lead** — cross-project questions (seams, sequencing, ownership disputes).
     Recorded in [DECISIONS](./DECISIONS.md); canon amended if needed.
   - **Mike** — only what changes ratified canon direction, and the decision *is* a canon PR
     he merges.
4. **Status flows through tracking issues.** Each project has a pinned
   "<project>: program tracking" issue; its PM posts a status comment per working session
   (shipped / in flight / blocked / decisions needed). The program lead runs a portfolio
   review at milestone boundaries: reconcile [ROADMAP](./ROADMAP.md), resolve escalations,
   open canon PRs. Mike reads exactly two things: the roadmap and canon PRs.
5. **Quality gates.** The fleet conventions in `ENG_TEAM_INSTRUCTIONS.md` apply, plus:
   spec-audit against the governing canon on any spec-implementing PR, and review against the
   three cross-project invariants (fail closed to asking · only humans loosen · approval is
   content-addressed) on every harness-program PR.
6. **Continuity: sessions are disposable; roles are not.** A role ("the PM of toolsmith")
   is the durable entity; any given session is a disposable executor of it. All context
   that belongs to the role must therefore live on the role's durable surfaces — charter +
   canon + tracking issue + issue queue — never only in a conversation. The discipline:
   decisions land in canon or DECISIONS the moment they're made; work items land as
   issues; working state, open threads, and next-actions land as a status comment on the
   tracking issue **at every convenient stopping point** (end of a work batch, before a
   long wait, after any ruling), not just session end. The restart test: could a fresh
   session with your charter pick up exactly where you stopped? If something would be
   lost, persist it before stopping — the externalized state is what makes discarding a
   session free. (This is the agent-type-harnesses thesis applied to ourselves: identity
   and context attach to the role, and the PM roster is its first dogfooding cohort.)
7. **Dogfooding ratchet.** Until the ratification plugin ships, ratification = plain PR merge
   by Mike. Once it works, the program's own config decisions ride signed changesets. Later,
   the PM roster becomes the first agent-type harness roster.
