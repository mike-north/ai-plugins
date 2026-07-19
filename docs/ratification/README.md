# The ratification layer (working name)

Canon for the **changeset/ratification layer** — the seam through which every other
harness-program product ratifies configuration decisions: agent-proposed config changes as
signed, committed changeset files, validated in CI against the trusted base, and merged by a
human. One human gate for the whole system; one uniform ceremony no consumer reinvents.

> **Status**: skeleton, drafts. These documents become **governing canon when Mike merges
> them**. Until then they are proposals under review — cite them in issues, but expect churn.
> The layer's public name is a working name pending
> [DECISIONS D-007](../harness-program/DECISIONS.md); the eventual rename is mechanical.

## Governance

These documents govern the fleet issues labeled **`plugin: ratification`**. Where an issue and
this canon disagree, **the canon wins until amended** — comment on the issue rather than
building the divergence. Amendments are ratified by Mike's PR merge; no other human ceremony
exists (per the [program README](../harness-program/README.md)).

The **changeset frontmatter schema** and the **CI validation contract** are program
contracts, not merely this layer's internals: their consumers are the judge, command steering,
and toolsmith. Changes to a contract surface follow the program's contract-change rule (every
party PM's sign-off + program-lead approval + Mike's merge); see
[how the pieces fit](../harness-program/how-the-pieces-fit.md) §"The shared contracts".

## Reading order

1. **Governing brief** — [the changeset layer](../harness-program/changeset-layer.md). The
   why: the TOCTOU failure sequence, what the layer adds on top of native changesets, the
   monorepo invariant, the byproduct changelog. Read it first; everything here specifies it.
2. [frontmatter-schema](./frontmatter-schema.md) — the sealed changeset's structured header:
   the judge's crystallized-memory index and the queryable decision record. A program
   contract.
3. [ci-validation-contract](./ci-validation-contract.md) — what the GitHub Action checks, in
   what order, and how each failure degrades. A program contract.
4. [porcelain-tool](./porcelain-tool.md) — the one narrow tool that fills the template, seals
   via attest-it, and opens the PR. Agents never hand-roll Ed25519.
5. [bootstrap-flow](./bootstrap-flow.md) — how the config monorepo comes into being: it is
   *created by running this product* ([DECISIONS D-003](../harness-program/DECISIONS.md)),
   never hand-scaffolded.

## Substrate and boundaries

The signing substrate is [attest-it](https://github.com/mike-north/attest-it), consumed
**unmodified** — see [attest-it as substrate](../harness-program/attest-it-substrate.md) and
the pure-consumption verification (attest-it issue #149). The moment this layer needs an
attest-it change, we stop and file a stakeholder issue; nothing program-specific leaks into
attest-it.

The **reconciler** — the deterministic step that applies merged `main` to the live system —
is designed against here but its *placement* (this layer vs. each consumer pulling its own
packages) is a program decision co-driven with the lead. See
[bootstrap-flow](./bootstrap-flow.md) §"The reconciler seam" for what this layer needs from
it, wherever it lands.

## The three invariants

Every design in this canon holds all three (program-wide, from
[how the pieces fit](../harness-program/how-the-pieces-fit.md)):

- **Fail closed to asking.** Any validation failure — malformed frontmatter, broken seal,
  unauthorized signer, dangling supersedes — keeps the change in the human-approval flow (CI
  red, no merge). Never silent denial, never silent allowance.
- **Only humans loosen.** An agent may propose any changeset and may sign it (attesting
  authorship), but the *merge* — the loosening — is a human's. The signer identity attests who
  wrote it, never that a grant is safe.
- **Approval is content-addressed.** The seal binds to exact committed content; any edit voids
  it and re-fires CI. Time-of-check equals time-of-use because validation runs against the
  immutable artifact in the diff, not against mutable server-side state (the PR description).
