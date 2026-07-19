# attest-it as the admission gate

Toolsmith PM · 2026-07-19 · design for issue #76

Governing canon: [Toolsmith, narrowed](../harness-program/toolsmith-narrowed.md) (admission
seals); [attest-it as substrate](../harness-program/attest-it-substrate.md) (the role, the
nothing-leaks rule); [contract](../harness-program/contracts/steering-toolsmith.md) §1–2;
[staged/live split](./staged-live-split.md) (promotion step 3, which this fills in).
External: `mike-north/attest-it` (consumed as-is; stakeholder verification recorded on
attest-it #149 — pure consumption confirmed on all three assumptions).

## What admission becomes

**Toolbox admission = an attest-it seal over the reviewed surface, by a human
presence-backed identity.** The agent-side `approve` ceremony stops being the authority and
becomes the *orchestrator* of a ceremony whose authority is cryptographic: agents literally
cannot produce the human's signature (the private key lives in 1Password/Keychain/YubiKey
behind a presence action), rather than being constitutionally discouraged from writing a pin.

The **sealed surface** is exactly what contract §1 calls the reviewed surface — one seal
covers, atomically:

- the tool's staged bytes (what promotion will place live),
- its registry entry's registration data: `covers` patterns, invocation template, `purpose`,
  grant tuples, `permissionRule`.

Sealing them together closes a gap pins never covered: today `approvedSha256` binds only the
script; a post-approval edit to `covers` or the grant surface is invisible to the hash. Under
attest-it, fingerprinting spans the whole surface — change any of it and the seal voids.

## Mechanics (attest-it primitives, nothing custom)

| Toolsmith concept | attest-it primitive |
|---|---|
| The admission gate | a gate in `.attest-it/policy.yaml` covering the toolbox paths (staging file + registry entry), `authorizedSigners`: the human identity only |
| The admission ceremony | a suite whose command is the **proposal gate** (`lint`) — `attest-it run --suite toolsmith-admission` runs lint, then prompts the human to confirm the seal (never `--yes` on this suite). *`run` is chosen over the bare `seal` verb deliberately*: both exist in the CLI (verified 0.10.1), but `run` binds the seal to a **successful gate execution**, so a tool cannot be admitted without its proposal gate having actually passed. `seal` would let the ceremony and the check drift apart. |
| The signature | Ed25519 seal by the human's presence-backed identity |
| "May this exist at all" | seal present + signer authorized for the gate |
| `approvedSha256` | derived from the sealed fingerprint at promotion (recomputed from placed bytes, per the staged/live TOCTOU rule) — the pin becomes a *cache of* the seal's content-address, not an independent authority |

The identity/key stack is attest-it-on-vaultkeeper as ratified: vaultkeeper is the safe
facade over the secret backends; attest-it adds the invalidatable attestation and the signer
identity. Nothing toolsmith-specific leaks into attest-it (the substrate doc's hard rule) —
toolsmith ships config (a policy gate + suite definition scaffolded by `init`), not attest-it
changes.

## Trust boundaries, stated honestly (the #149 caveat)

attest-it's own threat model, confirmed on #149: **plain `attest-it verify` is a local
pre-check that trusts the working-tree policy** — an agent that edits `policy.yaml` to enroll
its own key and re-seal passes plain verify. The trust boundary is verification **anchored to
a trusted base** (`verify --base <ref>` / the GitHub Action reading policy from the base
branch). Consequences, in order of arrival:

1. **What is cryptographically true immediately, even locally**: the agent cannot forge a
   seal *by the human's identity* — the presence-backed key never enters agent reach. Any
   self-enrolled seal is by a *different* signer.
2. **Interim promotion check (this design)**: promotion runs plain `verify` as the fast
   pre-check **plus a signer-identity pin**: toolsmith's config records the human identity's
   public-key fingerprint at setup, and promotion requires the admission seal's signer to
   match that pin — an anchor *outside* the working-tree policy file. This closes the
   self-enrollment hole for promotion without pretending to be a full base-anchored
   verification. Fail: refuse promotion (fail closed to asking — the human can inspect).
3. **The real boundary arrives with ratification**: once admission rides the config
   monorepo's CI (changeset layer), the GitHub Action verifies against the trusted base and
   the sealed-root-gate guarantee holds in full. This design's artifacts (gate, suite, seal)
   are exactly the shape that CI consumes — nothing is redone, the verification point moves.

**Version dependency (verified against the published CLI, 2026-07-19).** The base-anchored
path is documented on attest-it's `main`, but `main` reads `version: 1.0.0` while the latest
**published** npm release is `0.10.1`, whose `verify` exposes only `--json` — there is no
`--base` flag in the installable version. Filed as
[attest-it#151](https://github.com/mike-north/attest-it/issues/151) (release/doc alignment;
no API change requested). Consequences for this design, none of them blocking:

- Step 2's **signer-fingerprint pin is load-bearing, not belt-and-braces**, for as long as
  `--base` is unavailable to consumers installing from npm. It is what makes interim
  admission meaningfully agent-proof, and AC1 tests exactly that.
- The GitHub-Action route (used by ratification's CI) is unaffected — it is the boundary
  regardless of the local CLI's flags.
- Implementation must **pin the attest-it version** it consumes and re-check this when
  adopting a newer one; a release that adds `--base` lets promotion's step 4 upgrade from
  "plain verify + signer pin" to base-anchored verification with no other change.

## Scope split: project now, user gated on a ruling

attest-it seals **committed content in a clean git tree** — it is git-shaped by design.

- **Project scope**: works today. The project repo hosts `.attest-it/` policy and the sealed
  registry/staging paths; admission requires the staged tool + registry entry committed
  (which also gives admission a durable review artifact for free).
- **User scope** (`~/.claude/toolsmith/`): not a git repo today. Making it one just for
  seals would hand-scaffold exactly the runtime state D-003 says the ratification
  bootstrap creates (the config monorepo is user-scope config's eventual home). Whether
  user-scope admission **waits for the ratification bootstrap (#89)** or gets an **interim
  local git-init** is a cross-project sequencing question — escalated as a `needs-decision`
  / `decider: program-lead` issue filed alongside this design. Until ruled: user-scope
  admission keeps today's ceremony (pin + human confirmation) plus the signer-pin hardening
  where a seal exists; this design's project-scope path does not block on it.

## Promotion integration (staged/live step 3, filled in)

```
approve <name>:
  1. lint staged file                      (unchanged)
  2. show human: diff/full text + registration data   (unchanged)
  3. SEAL: attest-it run --suite toolsmith-admission   ← this design
     - refuses on dirty tree (attest-it's own rule)
     - human confirms at the attest-it prompt (the presence moment)
  4. VERIFY: plain verify + signer-fingerprint pin check; refuse on either failing
  5. apply manifest (place, 0555+uchg, recompute pin, ensure rule)   (unchanged)
  6. register into steering                       (unchanged, #77)
```

Re-promotion after an edit is the same flow — the old seal voided the moment the staged
content diverged, which is correct: *the staged/live split means the voided seal never locks
anything out; live keeps serving under its own still-valid admission.*

**Revocation** stays human-gated through the same ceremony; a revoked tool's seal is not
deleted (history is the audit trail) — the registry state and live placement are what change.

## Migration and rollout

- Ships after the staged/live split (sequenced #75 → #76); requires it (sealing targets
  staged content).
- Existing approved tools remain pin-only until their next promotion, at which point they
  acquire a seal — same lazy-migration posture as the staged/live protection bits.
- One-time setup per scope: `attest-it init` scaffolding + identity check + gate/suite
  definition + signer-fingerprint pin recorded. Shipped as an `approve --setup` (or skill
  step), never run silently.
- No version of this weakens an existing gate: a tool that fails seal verification falls to
  refuse-promotion / ask, never to silent allowance.

## Acceptance criteria

1. **Agent cannot self-admit**: with the human identity's key unavailable to the agent, no
   sequence of agent actions (including editing `policy.yaml` and re-sealing with a
   self-created identity) yields a promotable tool — the signer-fingerprint pin rejects it.
   Test with a synthetic second identity.
2. **Seal spans the full surface**: editing `covers` (or grants, or the script) after
   sealing voids the admission — promotion refuses. Test each element.
3. **Presence moment is real**: `run --suite toolsmith-admission` prompts (no `--yes` path
   in the promotion flow); non-interactive invocation fails fast rather than sealing.
4. **Lockout stays dead**: sealing a *revision* while live serves the prior admission never
   interrupts the live tool (staged/live invariant preserved end-to-end with seals on).
5. **Dirty-tree refusal**: admission against a dirty tree fails with attest-it's own error,
   surfaced legibly by approve.
6. **Fail-closed**: missing seal, invalid seal, signer mismatch, attest-it unavailable — all
   refuse promotion with distinct legible errors; none blocks the *live* tool from serving
   under its existing valid admission; nothing ever silently promotes.
7. Docs: registry-schema/authoring-checklist updated; the trust-boundary section (interim
   pre-check + signer pin vs. eventual base-anchored CI) documented where users will read it.

## Non-goals

- The ratification CI check itself (changeset layer's; this design only guarantees its
  inputs are the right shape).
- Judge identity enrollment (M2; the authorship-not-endorsement distinction lives in the
  judge brief).
- Any attest-it modification (pure consumption per #149; anything discovered otherwise gets
  filed on attest-it, not built around).
- User-scope git topology (escalated; see scope split).
