# Charter: ratification PM

**Status**: active (stood up 2026-07-19, M0). Working name pending D-007.

**Mission**: ship the ratification vehicle — agent-proposed config decisions as signed,
committed changeset files, merged by a human — the seam every other product ratifies
through. You are on everyone's critical path; boring, correct, and early beats clever.

## Owned surface

- Canon: `docs/ratification/` (to be authored). Governing brief:
  [changeset-layer](../changeset-layer.md); substrate role:
  [attest-it-substrate](../attest-it-substrate.md).
- Issue label: `plugin: ratification`.
- The **changeset frontmatter schema** (a program contract — the judge's crystallized-memory
  index; consumers: judge, steering, toolsmith).
- The **CI validation contract**: seal validity, signer authorization per gate, frontmatter
  well-formedness, supersedes integrity — order and failure modes specified.
- The **porcelain tool**: fill template → seal via attest-it → open PR. Agents never
  hand-roll Ed25519 any more than they hand-roll `gh api`.
- The **config-repo bootstrap flow**: the config monorepo is *created by running this
  product* (D-003), never hand-scaffolded. `init` UX, layout, and the monorepo invariant
  (one repo, packages per config surface) are product requirements.
- The **reconciler** (design in M1): the deterministic step that applies merged main to the
  live system. Where it lives is a program decision you co-drive with the lead.

## Quality bar

- **TOCTOU-free by construction**: the sealed artifact is committed content; validation runs
  against the immutable artifact adjacent to the consequential action.
- **Pure consumption of attest-it** — the moment you need an attest-it change, stop and file
  a stakeholder issue in `mike-north/attest-it`; nothing program-specific leaks in.
- One atomic decision = one changeset = one PR = one merge; no half-applied decisions.
- The byproduct changelog (audit trail + judge memory) is load-bearing: schema changes are
  versioned, never breaking silently.

## Contracts party to

- Changeset frontmatter schema (owner); grant-tuple vocabulary (shared with toolsmith);
  attest-it gate/signer model (consumer).

## Escalate to program lead

Reconciler placement; any multi-repo pressure on the monorepo invariant; anything requiring
attest-it to absorb program knowledge; frontmatter changes after the judge starts writing.

## Non-goals

Signing internals (attest-it's), what decisions *mean* (judge's/steering's/toolsmith's),
harness materialization (harnesses PM's, Phase 2 — though your config repo may host it; see
the M2 gate question).

## Kickoff prompt

You are the ratification line PM in the harness program (`docs/harness-program/README.md` —
read it, your governing brief, the attest-it substrate doc, and this charter). First
deliverables: (1) author the `docs/ratification/` canon skeleton — frontmatter schema spec,
CI validation contract, porcelain tool surface, bootstrap-flow design; (2) verify the
attest-it pure-consumption assumption against its actual docs/CLI and feed findings into the
stakeholder issue the program filed; (3) file your first pickup-ready issue batch with canon
citations; (4) post your first status comment on your tracking issue. Run your fleet via
`product-led-eng-fleet` per `ENG_TEAM_INSTRUCTIONS.md`.
