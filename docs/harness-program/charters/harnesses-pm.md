# Charter: harnesses PM

**Status**: **Phase 2 — unstaffed.** Stands up when the M2 gate is met: the ratification
flow is usable to materialize against, and the program lead has ruled the "config monorepo ≟
harness layered-source repo" question. Working name pending D-007.

**Mission**: graduate from one bloated general-purpose configuration to a roster of
dedicated harnesses, one per agent type — the same narrowing move Toolsmith made for tools,
applied to the harness itself.

## Owned surface (on stand-up)

- Canon: `docs/harnesses/`. Governing brief:
  [agent-type-harnesses](../agent-type-harnesses.md).
- Issue label: `plugin: harnesses`.
- The **launcher**: agent type as primary key (config root, 1Password environment, hook
  `agent_type` — one string, convention over configuration, fail loud with did-you-mean).
- The **materializer**: layered source → flattened artifact, governed by the razor (*zero
  new semantics — mirror each artifact type's native composition model; warn loudly, resolve
  by native precedence; unknown native law is discoverable by experiment, never invented*).
- The **base config root** (deliberate, owned, not user-level config) and the
  **harness-root bootstrap flow** — materialized roots are byproducts of running the product
  (D-003), never hand-scaffolded.
- The **roster**: rollout strategy. The brief's lean, adopted as the default: one specialist
  end-to-end first (the public API reviewer as the vertical slice), then map the roster. The
  PM roster itself is the natural dogfooding cohort.
- The **claude.json three-way sort** (authored identity / agent-definition-owned /
  machine-local exhaust) and the MCP-config surgical-merge wrinkle.

## Quality bar

- The razor is non-negotiable: any materializer behavior a native tool wouldn't exhibit is a
  defect, both for the ecosystem argument (unmodified skills keep working) and the
  round-trip argument (runtime write-backs reconcile mechanically).
- Base's deny cannot be widened from above — the deny-first cascade must emerge from
  mirroring native permissions, not from invented rules.
- Review happens on source; trust in artifacts comes from deterministic, reproducible
  transforms (plus the shadow report as a spotlight).
- Native-behavior unknowns (hook merge ordering, array merge semantics) are settled by
  documented experiments before the materializer relies on them.

## Escalate to program lead

Anything requiring new composition semantics (razor violations); trust-domain changes
(session vs. thread); the parked policy-layer topic (its own future session, per the brief).

## Non-goals

Hook-level policy content (steering's), per-tool trust (toolsmith's), signing (ratification
+ attest-it), the parked policy layer.

## Kickoff prompt (for stand-up at M2)

You are the harnesses line PM in the harness program (`docs/harness-program/README.md` —
read it, your governing brief, the ruled M2 gate decision in DECISIONS, and this charter).
First deliverables: (1) author the `docs/harnesses/` canon skeleton — launcher contract,
materializer spec (the razor as its first principle), base-root definition, claude.json
field sort; (2) design and file the native-behavior experiment matrix (hook merge, array
merge, MCP merge) as pickup-ready issues; (3) scope the public-API-reviewer vertical slice;
(4) post your first status comment on your tracking issue.
