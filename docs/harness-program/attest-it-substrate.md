# attest-it as the ratification substrate

> **Status**: adopted into the harness program canon 2026-07-19 (moved from the original brainstorm drafts). Governs fleet work per [README](./README.md).


Mike North · 2026-07-18

One of six companion docs. Start with [How the pieces fit](./how-the-pieces-fit.md). This is an addendum to the existing [attest-it](https://github.com/mike-north/attest-it) project, not a new project — attest-it already exists and already has its own docs, threat model, and CLI. This doc records the new role it takes on and what, if anything, that role demands of it.

## Where it came from

attest-it was built for manual test suites: a non-agent-defeatable CI check ensuring that whenever a certain set of files changed, a local human-run test suite was actually run. Ed25519 identities with keys in 1Password, Keychain, YubiKey, or encrypted files; gates that define which files require attestation and who may sign; fingerprinting so any content change invalidates the seal; a sealed root gate so a PR can't add itself to the team. Its stated primary threat is an AI assistant creating a fake attestation.

That's the same primitive this whole system needs. Test attestation and tool admission are one question wearing different clothes: **whenever this content changes, did a human really vouch for it — and can an agent fake the vouching?** It answers no on the second, cryptographically. This is the accidental-platforming thesis paying off: a narrow tool built for one job, correctly, turned out to already solve a problem we hadn't articulated when it was built.

## The role

attest-it is the **shared human-presence signing substrate** for all three sibling projects. Same gate mechanism, same fingerprint-invalidation, same authorized-signer check — three different artifact types:

- **Toolsmith** seals a forged tool's content at admission (and the runtime bundle, and harness wrappers).
- **The judge** seals its config proposals — and is itself enrolled as a signer: its own keypair, authorized for the config-change gate *and only that gate*. The `authorizedSigners`-per-gate model already expresses this; no new mechanism needed.
- **Command steering** has its routing-config changes sealed through the same flow.

The concrete carrier for all three is the changeset file (see [the changeset layer](./changeset-layer.md)): the sealed artifact is committed content in the config repo, validated in CI against the trusted base, exactly attest-it's existing GitHub-Action shape.

## What attest-it must not absorb

Nothing. It stays generic. No knowledge of Toolsmith, the judge, steering, changesets, or agent harnesses may leak into it — it proves "a human (or an authorized identity) was present and vouched for exactly this content," whatever the content is. Every project-specific opinion lives in the consumer. The moment attest-it grows a `--toolsmith` flag, we've broken the thing that made it reusable.

## Open questions

- **Does this role require any attest-it changes at all?** My working assumption is pure consumption: non-interactive identity creation already exists (the CI-bot flow), per-gate signer authorization already exists, base-ref-anchored verification already exists. Worth a deliberate pass to confirm — the answer shapes whether attest-it work appears on the roadmap at all.
- **How do agent identities sit alongside human identities in a team?** The judge's key is file-backed or vault-backed but not human-presence-backed — that's the point of the authorship-not-endorsement distinction. Whether attest-it should *distinguish* presence-backed signers from automation signers in its model (so a gate can require "at least one presence-backed signature"), or whether that stays a consumer-side convention, is worth deciding deliberately.
