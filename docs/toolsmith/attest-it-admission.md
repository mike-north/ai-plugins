# attest-it as the admission gate

Toolsmith PM · 2026-07-19 · design for issue #76 · amended 2026-07-21 (#133, Mike's approval-channel ruling)

Governing canon: [Toolsmith, narrowed](../harness-program/toolsmith-narrowed.md) (admission
seals); [attest-it as substrate](../harness-program/attest-it-substrate.md) (the role, the
nothing-leaks rule); [contract](../harness-program/contracts/steering-toolsmith.md) §1–2;
[staged/live split](./staged-live-split.md) (promotion step 3, which this fills in).
External: `mike-north/attest-it` (consumed as-is; stakeholder verification recorded on
attest-it #149 — pure consumption confirmed on all three assumptions).

## What admission becomes

**Toolbox admission = an attest-it seal over the reviewed surface, by a human
presence-backed identity.** The agent-side `approve` ceremony is a *facilitator*, never the
authority and never the intermediary: agents literally cannot produce the human's signature,
rather than being constitutionally discouraged from writing a pin.

**Presence is a per-signature requirement, not a property the backend happens to have**
(Mike's ruling, 2026-07-21, #133). The identity stack lists 1Password / Keychain / YubiKey,
but those backends differ exactly where it matters: a vault-resident key that signs from an
already-unlocked session — no per-signature interaction — is completable by an agent driving a
pty, and the "non-interactive invocation fails fast" check (AC3) does not catch an agent that
*can* drive interactive input through a pty helper. So the requirement is on the *signature
event*, not the storage: **the admission identity MUST demand a per-signature human-presence
action (hardware touch / biometric) that no software path can supply.** A key configured to
sign without that interaction does not satisfy admission. `approve --setup` verifies and
records this property and refuses an identity that cannot demonstrate it (see §Acceptance
criteria, AC3a).

**The agent is never the intermediary between the human's approval and toolsmith** (same
ruling). Agents may *facilitate* — open an independent terminal, kick off the review flow,
poll for the resulting seal — but the review→approval→signature moment happens in the human's
own terminal, never inside an agent-controlled TTY. The mechanics are in §Promotion
integration; the principle is that the only thing crossing back from the human to toolsmith is
a cryptographic seal the agent cannot forge, produced by a presence action the agent cannot
perform.

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
  bootstrap creates (the config monorepo is user-scope config's eventual home). **Ruled
  (D-018, 2026-07-21): user-scope admission waits for the ratification bootstrap (`ratify
  init`, #89) — no interim local git-init.** Until that lands, user-scope admission keeps
  today's ceremony (pin + human confirmation) plus the signer-pin hardening where a seal
  exists; project-scope admission proceeds now and does not wait. Per D-018, user-scope
  admission becomes part of #89's acceptance surface: the ratification bootstrap must account
  for scaffolding the toolsmith gate/suite, coordinated via the shared-surface process (neither
  line specifies the other's work).

## Promotion integration (staged/live step 3, filled in)

Two hosting modes, because *whose terminal runs the seal* is the crux of Mike's ruling:

- **Human-driven** (a person runs `approve` at their own terminal): steps 1–6 run inline; the
  attest-it prompt at step 3 is already in the human's TTY, so the presence moment is native.
- **Agent-driven** (an agent runs `approve` as part of a task): `approve` does **not** host the
  seal. It runs the pre-checks (lint, dirty-tree), then **emits the exact seal command and the
  review surface for the human to run in their own independent terminal**, and stops. The agent
  may open that terminal and kick the flow off, then **poll for the seal to appear** — but the
  attest-it prompt is never wrapped in an agent-controlled pty. The agent resumes (step 4
  onward) only once a valid seal exists on disk. This is the agent-never-intermediary rule made
  mechanical: the only thing crossing back from the human is the seal itself.

```
approve <name>:
  1. lint staged file                      (unchanged)
  2. render review surface from the SEALED content — the diff/full-text the human
     reviews is generated from the exact committed bytes the seal will cover, and the
     printed seal command comes from the SAME deterministic tool output, so a
     re-rendering agent is not in the trust path (amendment 3, #133)
  3. SEAL: attest-it run --suite toolsmith-admission
     - refuses on dirty tree (attest-it's own rule)
     - runs in the HUMAN's independent terminal; the human confirms at the attest-it
       prompt via the per-signature presence action (the presence moment)
     - agent-driven mode: approve emits this exact command + review surface and polls
       for the seal; it never hosts the prompt
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
- One-time setup per scope: `attest-it init` scaffolding + identity check (**including the
  per-signature-presence verification of AC3a**) + gate/suite definition + signer-fingerprint
  pin recorded. Shipped as an `approve --setup` (or skill step), never run silently.
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
3a. **Per-signature presence is required, not assumed** (#133): `approve --setup` accepts an
   identity only if it demands a per-signature human-presence action (hardware touch /
   biometric), and refuses one that can sign from an unlocked session with no interaction.
   Test: an identity backed by a key that signs without per-use presence is rejected at setup;
   a touch/biometric-gated identity is accepted. This is what closes the pty-driver hole AC3
   alone leaves open — an agent that *can* drive interactive input still cannot supply a
   hardware presence action.
3b. **Agent is never the intermediary** (#133): in agent-driven mode, `approve` emits the seal
   command and review surface and polls for the resulting seal; it never hosts the attest-it
   prompt in its own TTY. Test: an agent-driven `approve` produces no seal by itself (the
   presence step is external), and resumes to VERIFY only once a seal produced in a separate
   terminal appears — proving the approval signal reaches toolsmith only as a forgeable-proof
   seal, not as an agent-relayed confirmation.
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
- User-scope git topology (ruled D-018 — waits for the ratification bootstrap; see scope split).
