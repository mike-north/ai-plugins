# The config-monorepo bootstrap flow (design note)

> **Status**: draft. Becomes governing when Mike merges. Governing decision:
> [DECISIONS D-003](../harness-program/DECISIONS.md) — runtime repos are byproducts of using
> the products. Governing brief: [the changeset layer](../harness-program/changeset-layer.md)
> §"The monorepo invariant".

The config monorepo is **created by running this product**, never hand-scaffolded. That is not
an implementation convenience — it is the load-bearing consequence of D-003: `ai-plugins` holds
products (plugins, canons); runtime state appears where users run them. So the `init` flow, the
repo layout it produces, and the monorepo invariant it enforces are **first-class product
requirements of this layer**, specified here.

## What `init` produces

`ratify init` (working name; see [porcelain-tool](./porcelain-tool.md)) scaffolds a single git
repository — the config monorepo — with everything the ratification flow needs to be live from
the first commit:

1. **A git repo** with `main` as the ratification base. `main` is the trusted base every CI
   validation anchors to ([ci-validation-contract](./ci-validation-contract.md)).
2. **Changeset packages** — one per config surface, the "packages" of the monorepo:
   `settings.json`, hook config, steering rules, the toolbox, each its own package with its own
   coherent per-artifact changelog. Native changesets handle monorepos natively; we lean in
   rather than fight it (brief §"The monorepo invariant").
3. **The attest-it policy** — `.attest-it/policy.yaml` with:
   - a **root gate** so a PR can't add itself to the team (attest-it's sealed-root-gate
     property);
   - a **config-change gate** whose `fingerprint.paths` cover the changeset packages and whose
     `authorizedSigners` list is the set of identities permitted to seal config decisions;
   - the initial signer enrollment (the human bootstrapper, and — when the judge stands up in
     M2 — the judge's automation identity, scoped to the config-change gate *and only that
     gate*).
4. **The CI workflow** — `.github/workflows/` running the checks in the
   [CI validation contract](./ci-validation-contract.md) via attest-it's GitHub Action, in the
   specified order, base-anchored. This is why that contract is also the spec for what `init`
   writes.
5. **Changesets configuration** wiring the packages so the native tooling and the byproduct
   changelog (audit trail + judge memory) work from day one.

## The monorepo invariant

**One repo, one changeset root, packages per config surface.** The invariant exists so that a
decision spanning several artifacts — forge a tool here, tighten a hook rule there — is a
single multi-package changeset: one atomic decision, one PR, one human approval, one merge,
each package keeping its own changelog. No half-applied decisions where the tool landed but the
rule didn't. `init` establishes this and the tooling preserves it.

The brief's critical decision — *do all config surfaces genuinely live in one repo?* — is
resolved here in the affirmative, following the brief's own lean: **make the config monorepo a
real single repo and preserve the one-to-one invariant** rather than accept multiple changeset
roots (losing the unified log) or build an aggregation layer (needless complexity). If physical
reality ever forces surfaces apart (dotfiles in one place, a plugin repo in another), that is a
program escalation (charter: "any multi-repo pressure on the monorepo invariant"), not a thing
`init` quietly works around.

## The reconciler seam

After a human merges to `main`, a deterministic **reconciler** applies main to the live system:
places forged tools, flips executable bits, updates `settings.json`, activates steering rules —
the step that turns a ratified changeset into live configuration.

**Placement is ruled ([DECISIONS D-010](../harness-program/DECISIONS.md)): the reconciler lives
in this layer.** One deterministic applier ships with ratification; consumers stay declarative
via **per-package apply manifests** (what goes where, which executable bits flip, which
validations run) and never execute their own pullers. Rationale: atomicity must survive past
merge into apply — N independent pullers reintroduce the half-applied states the changeset model
exists to prevent. The **apply-manifest format is this layer's scope** (spec owed in the M1
batch; see the reconciler/manifest issue).

The requirements below are ratified as binding (D-010). The reconciler must:

- It reads only **merged, ratified** content from `main` — never a PR head, never an unsealed
  or unvalidated changeset. Apply happens strictly after the human merge.
- It is **deterministic and idempotent**: applying the same `main` twice is a no-op the second
  time. Content-addressing makes this natural (live is pinned by signed hash; re-applying the
  same hash changes nothing) — the same mechanism toolsmith already relies on for promotion.
- It **fails closed**: a reconcile step that can't complete leaves the prior live state intact
  and surfaces the failure; it never partially applies a multi-package decision (atomicity
  carries past merge into apply).

## The M2 gate question (flagged, not decided)

The roadmap flags a program decision owed **before M2**: *is the config monorepo also the
harness layered-source repo?* The monorepo invariant here and the harnesses PM's
materialized-branch design both point toward "yes — one repo, `main` = layered source,
materialized branch = artifact," but this is the program lead's call with the harnesses PM, not
this layer's. `init`'s layout should not foreclose that outcome — design the package layout so a
harness layered-source could join the same repo without a reorg. Recorded in
[DECISIONS](../harness-program/DECISIONS.md) when ruled.

## Open questions

- **`init` idempotence and re-run.** What `init` does against an existing config repo (refuse?
  reconcile missing pieces? upgrade the policy/workflow?) — lean: refuse to clobber, offer an
  explicit `--upgrade` path that only adds missing scaffolding.
- **Initial signer bootstrapping.** The first human signer must be enrolled before any
  changeset can be sealed; how `init` drives attest-it identity creation for the bootstrapper
  (interactive vs. referencing an existing identity) — settle against attest-it's identity
  surface.
- **Where the config repo lives** (a user's dotfiles repo, a dedicated repo) and how the tools
  locate it — a discovery/config question shared with the porcelain tool.
