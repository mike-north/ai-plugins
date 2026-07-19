# CI validation contract (draft)

> **Status**: draft. Program contract. Becomes governing when Mike merges. Governing brief:
> [the changeset layer](../harness-program/changeset-layer.md) §"Open questions" (this doc is
> the requested spec for "what the GitHub Action checks and in what order").

Specifies what CI validates on every push to a ratification PR, the order, and how each
failure degrades. The whole contract exists to make one property true by construction:
**the artifact validated is the immutable committed content adjacent to the merge**, so
time-of-check equals time-of-use (no TOCTOU gap of the kind the PR-description-signing dead
ends hit).

## The trust anchor: base-ref-anchored, always

The single most important rule, confirmed against attest-it directly (issue #149 findings):

> **Plain `attest-it verify` is NOT a trust boundary.** It trusts the working-tree policy, so
> a PR could rewrite its own `.attest-it/policy.yaml` (add itself as an authorized signer) and
> pass. Only `attest-it verify --base <ref>` — or attest-it's GitHub Action, which loads
> policy from the PR base branch automatically — is a real gate.

Therefore this contract **mandates base-anchored verification** against the PR's base branch
(`main` of the config monorepo). Policy — the root gate, team, gate definitions, and
`authorizedSigners` — is read from the **trusted base**, never from the head. A self-added
signer resolves to `UNKNOWN_SIGNER` and fails. Plain `verify` may be used only as a local
pre-check in the porcelain tool; it is never the CI gate.

CI validates **whatever the head ref resolves to, on every push** — no SHA-pinning bookkeeping
in the PR description. Push a tampering commit and CI re-fires against the new head; the seal
breaks.

## The checks, in order

Ordered cheapest-and-most-foundational first, so a failure reports the actionable cause rather
than a downstream symptom. Every check is deterministic. **Any failure fails the build; a red
build cannot merge; the change therefore stays in the human-approval flow — this is
"fail closed to asking" realized as CI status.** CI never emits an allow; it only blocks.

1. **Frontmatter well-formedness.** Parse the YAML header of each changed changeset file
   against [frontmatter-schema](./frontmatter-schema.md): valid YAML (strict), `schemaVersion`
   present and a known major (unknown major → fail closed), all `req` fields present, enums in
   range, conditionally-required fields present when their condition holds (`redirectTarget`
   iff `verdict = redirect`, `scopeValue` iff `scope ≠ global`, etc.). Runs first because no
   later check is meaningful over a header we can't trust the shape of.

2. **Seal validity (base-anchored).** `attest-it verify --base <base-ref>` (or the Action) over
   the changed changeset package(s). Passing means: the seal exists, its Ed25519 signature is
   valid, and the fingerprint matches — the committed content is exactly what was sealed. A
   `MISSING`, `INVALID_SIGNATURE`, or `FINGERPRINT_MISMATCH` state fails the build. (`STALE` is
   a warning in attest-it's model; whether we treat max-age as fatal for config changesets is
   an open question below.)

3. **Signer authorization per gate.** From the same base-anchored verification: the sealing
   identity must be in the config-change gate's `authorizedSigners` **as defined in the trusted
   base**. `UNKNOWN_SIGNER` fails. This is where "the judge is a signer for the config-change
   gate and only that gate" is enforced — a seal by any identity not authorized for *this* gate
   is rejected, and a PR cannot enroll a new signer for itself (the self-added-signer case,
   caught because policy comes from base).

4. **Supersedes integrity.** For any changeset with a non-null `supersedes`: the target `id`
   exists in the config monorepo's history, and is not itself already superseded by a
   *different* live changeset (no forked supersede chains, no dangling pointer). Purpose, from
   the brief: the log must not accrete contradictions the judge can't resolve. Runs last
   because it is the only check that reads beyond the changed files into the existing log.

## Cross-cutting rules

- **`cross_project`:** checks 2 and 3 are attest-it's job, invoked as attest-it, never
  reimplemented here. If a check needs behavior attest-it lacks, that is a stakeholder issue
  against attest-it, not a local workaround (charter: pure consumption).
- **Atomicity.** One changeset = one atomic decision = one PR. A multi-package changeset (a
  decision spanning several config surfaces) is validated as a set: **all** packages' seals and
  frontmatter pass, or the build fails. No half-validated decision reaches merge (the monorepo
  invariant, brief §"The monorepo invariant").
- **No allow from CI.** A green build is *permission to let a human merge*, not an automated
  merge. The human merge is the ratification (invariant: only humans loosen).
- **Determinism and hot-path.** Validation is pure over committed content; it does not reach
  the network except for attest-it's base-ref read. Re-running on the same head is idempotent.

## Failure-mode summary

| Failing check | attest-it/parse state | Outcome |
|---|---|---|
| Malformed / schema-invalid header | (local parse) | Build red — fix the changeset |
| Unknown `schemaVersion` major | (local parse) | Build red — fail closed; consumer can't safely read |
| Tampered content | `FINGERPRINT_MISMATCH` | Build red — re-seal required |
| Bad signature | `INVALID_SIGNATURE` | Build red |
| No seal | `MISSING` | Build red |
| Signer not authorized for gate | `UNKNOWN_SIGNER` | Build red — includes self-added-signer |
| Dangling / forked supersede | (local log walk) | Build red |
| All pass | `VALID` | Build green — a human *may* merge |

## Open questions

- **`STALE` / max-age policy.** attest-it warns on `STALE` (seal older than `maxAge`). Config
  changesets are short-lived (propose → merge in one PR), so a max-age may be unnecessary or
  even harmful (a legitimately-open PR ages). Lean: no `maxAge` on the config-change gate;
  confirm when the gate is defined in [bootstrap-flow](./bootstrap-flow.md).
- **Exact Action reference and pinning.** The precise attest-it GitHub Action ref/version is
  confirmed at implementation against attest-it's current docs (do not hardcode a guessed
  `uses:` line into canon). Pin by version per the repo's no-floating-refs discipline.
- **Where CI runs.** The config monorepo is a byproduct repo created by bootstrap; its CI
  workflow is emitted by the `init` flow (see [bootstrap-flow](./bootstrap-flow.md)), so this
  contract is also the spec for what `init` writes into `.github/workflows/`.
