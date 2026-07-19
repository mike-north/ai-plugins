# Identity and enrollment (design, M2-gated)

> **Status**: draft design — becomes governing when merged. **Nothing here is provisioned
> until M2**; this document exists so the custody answer shapes the design rather than
> retrofitting it. Governing brief: [the judge](../harness-program/judge.md) §"The judge's
> identity". Substrate: [attest-it](../harness-program/attest-it-substrate.md), consumed
> unmodified (pure consumption confirmed, attest-it#149).

## Enrollment

The judge is an attest-it signer with its own Ed25519 keypair, enrolled in the config
monorepo's team and authorized for **the config-change gate and only that gate** — expressed
entirely through attest-it's existing `authorizedSigners`-per-gate model; no new mechanism.
Enrollment happens at `ratify init` time (or as a later policy amendment), per
[bootstrap-flow](../ratification/bootstrap-flow.md).

Three properties this buys (from the brief, binding):

- **Provable authorship.** CI enforces that config-change PRs carry the judge's signature,
  base-anchored (`verify --base` — plain `verify` is not a trust boundary, per attest-it#149).
  A desperate coding agent that discovers "open a PR against the config repo" cannot produce
  the signature — the attempt is *visible* instead of indistinguishable from legitimate
  proposals.
- **Authorship, never endorsement.** The signature means "this proposal legitimately came
  from the judge," never "the judge vouches this grant is safe." Safety-vouching for
  loosening is reserved for the human merge.
- **Structured risk communication.** The judge fills the risk template in the changeset it
  signs, so the human ratifies authenticity plus stated risk rather than adjudicating a raw
  config diff cold.

Every judge-signed changeset stamps `judgeHarnessVersion` ("which mind made the call") per
the [frontmatter-schema](../ratification/frontmatter-schema.md) — enabling the
"every live rule from a harness older than N" query on upgrade.

## Custody

The load-bearing property: **the key must be usable non-interactively by the judge's
harness, but never extractable by the agents it governs.** A desperate coding agent must not
be able to produce the judge's signature — that visibility property is the point.

- **Preferred model**: delegated signing held by vaultkeeper — raw key material never enters
  the judge's (or any agent's) environment; the harness holds only a scoped signing
  capability. **Explicitly deferred to vaultkeeper#261's answer**; this canon adopts
  whatever custody model that recommendation lands, via amendment.
- **Named fallback (interim only)**: a file-backed key in the judge's dedicated 1Password
  environment, passphrase via `ATTEST_IT_KEY_PASSPHRASE` out-of-band (attest-it's CI-bot
  flow). Permitted only if M2 arrives before vaultkeeper#261 is answered, and only with the
  environment scoped to the judge's agent type alone.
- **Presence distinction**: attest-it does not model presence-backed vs automation signers
  (attest-it#150, open). Until/unless that changes, "the judge's signature is automation,
  not human presence" is a **consumer-side convention this canon states normatively**: no
  gate configuration may ever count the judge's signature toward a human-presence
  requirement. Human ratification is expressed as the PR merge, not a second seal.

## The risk template (changeset body) — ownership

The changeset **header** schema is unambiguously the ratification layer's
([frontmatter-schema](../ratification/frontmatter-schema.md)). The changeset **body** — the
judge's risk template — is **this canon's**: its structure is defined by the judge line,
versioned here, and consumed opaquely by the porcelain tool (`--body-file` today; a
template-by-reference flag if ever worth building). This resolves the boundary question
left open in [porcelain-tool](../ratification/porcelain-tool.md) §"Open questions".

The template's required content (format spec is a design-phase issue):

- The **risk level** and its justification, per [risk-vocabulary](./risk-vocabulary.md).
- **Factors weighed** — what made this necessary, what bounded the risk.
- For loosening proposals: why the capability is needed, what narrower alternative was
  rejected, and what the blast radius of the grant is.

Header and body are sealed together — any edit to either voids the seal.

## Non-goals

- No attest-it changes; the moment one seems needed, stop and file a stakeholder issue.
- No key provisioning, enrollment, or signing before M2.
- The porcelain tool's mechanics (sealing, PR opening): ratification's.
