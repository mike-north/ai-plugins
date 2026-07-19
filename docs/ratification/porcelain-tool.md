# The porcelain tool (surface sketch)

> **Status**: draft sketch. Becomes governing when Mike merges. Governing brief:
> [the changeset layer](../harness-program/changeset-layer.md) §"What the layer adds" (the
> porcelain-tool bullet). Command name is a working name pending
> [DECISIONS D-007](../harness-program/DECISIONS.md).

The one narrow tool that turns a config decision into a ratification PR: **fill the template →
seal via attest-it → open the PR.** Its whole reason to exist is the composability thesis
applied to itself — *the judge shouldn't hand-roll Ed25519 signing any more than a coding
agent should hand-roll `gh api`.* One reviewed, allowlistable tool does the mechanics so no
consumer touches signing internals or the changeset file format directly. This is the exact
toolsmith pattern (a broad, hard-to-allowlist operation replaced by a single-purpose tool),
turned on the ratification flow.

## Who calls it

Agents (the judge; the toolsmith curator) and humans. The caller supplies the *decision*; the
tool owns the *mechanics*. Non-interactive by default (agents run it unattended), with the
attest-it passphrase supplied out-of-band (`ATTEST_IT_KEY_PASSPHRASE`), exactly attest-it's
CI-bot flow.

## The surface (sketch)

A single verb-first command; names illustrative.

```
ratify propose \
  --verdict deny \
  --direction tightening \
  --command-pattern 'curl * | sh' \
  --intent ssh-always@v3#2,4 \
  --scope agent-type --scope-value code-reviewer \
  --triggering-observation 'curl https://x/i.sh | sh' \
  --risk necessary-evil \
  --package steering-rules \
  --body-file ruling.md
```

What it does, in order:

1. **Resolve identity and gate.** Determine the signing identity (the caller's attest-it slug)
   and the config-change gate. Refuse if the identity is not authorized for that gate in the
   current base policy — fail *before* writing anything (no orphaned branches).
2. **Fill the template.** Assemble the [frontmatter schema](./frontmatter-schema.md) header
   from the flags, allocate a stable `id`, set `ratificationStatus: proposed` and the
   `schemaVersion`, and — for a `commandPattern` — stamp the **active steering matcher version**
   into `commandPattern.matcherVersion` (D-011; the ruling is pinned to the semantics it was
   authored against). Attach the body (the judge's risk template). Validate the header locally
   against the schema — the same well-formedness check CI runs first — so a malformed changeset
   never leaves the machine.
3. **Write the changeset file** into the named package(s) under the config monorepo. A
   multi-package decision writes one coherent set (one atomic decision → one changeset → one
   PR), per the monorepo invariant.
4. **Seal it.** `attest-it seal <config-change-gate>` over the written file(s). The tool never
   constructs a signature itself; it shells to attest-it. It then runs a local
   `attest-it verify --base` pre-check (advisory only — CI's base-anchored verify is the real
   gate) to catch obvious problems early.
5. **Branch, commit, push, open PR.** Commit the changeset + seal on a fresh branch; open a PR
   whose **description is a pointer, not a payload** — a URL to the rendered changeset file at
   the PR head ref, plus a one-line summary. The trust lives in the committed, sealed file; the
   description is mutable ergonomics that CI never reads.

## What it must guarantee

- **Never hand-roll crypto.** All sealing/verifying is delegated to the attest-it CLI. If the
  tool ever needs an attest-it capability that doesn't exist, that is a stakeholder issue, not
  a local reimplementation.
- **Fail closed.** Any step failing (unauthorized signer, seal failure, push rejected) aborts
  cleanly and reports; it never opens a PR with an invalid or unsealed changeset, and never
  leaves a half-written changeset committed.
- **Local pre-check mirrors CI.** The header validation and pre-seal-verify it runs are the
  same checks in the [CI validation contract](./ci-validation-contract.md), so a PR the tool
  opens is one it has every reason to believe will go green — CI remains the authority, the
  tool is just a good citizen.
- **Only proposes.** The tool stops at PR-open. It never merges — the merge is the human's, and
  the merge is the ratification (invariant: only humans loosen). It has no path to self-ratify.
- **Version reported from package metadata**, never a hardcoded literal (repo rule), so a
  changeset's provenance can be traced to the exact tool build if ever needed.

## Open questions

- **Packaging.** Is this a toolsmith-forged tool (dogfooding the forge), a standalone plugin
  CLI in this layer, or a subcommand of a broader `ratify` porcelain that also wraps the
  bootstrap `init`? Lean: one `ratify` CLI in this layer with `init` and `propose` subcommands,
  so the layer ships one coherent porcelain surface. Confirm at implementation.
- **Template source.** Where the body template (the judge's risk format) lives — here, or in
  the judge canon — is a boundary question. The *header* schema is unambiguously this layer's;
  the *body* format is arguably the judge's. Coordinate with the judge PM in M2; until then the
  tool accepts an opaque `--body-file`.
- **Identity discovery.** How the tool learns the caller's attest-it slug (flag, env, config)
  without the caller handling key material — settle against attest-it's identity-resolution
  surface.
