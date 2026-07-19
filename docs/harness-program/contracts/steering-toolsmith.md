# Contract: command-steering ↔ toolsmith

> **Status**: ratified program contract (promoted 2026-07-19 from issue #71, adopted per
> [DECISIONS D-004/D-005](../DECISIONS.md)). Parties: command-steering PM, toolsmith PM.
> Changes require both parties' sign-off, program-lead approval, and Mike's merge.
> Implementation tracking: issue #71.

## Purpose

The governing contract between the **command-steering plugin** and the narrowed **toolsmith
plugin**, per [Toolsmith, narrowed](../toolsmith-narrowed.md),
[command steering](../command-steering.md), and
[how the pieces fit](../how-the-pieces-fit.md). Toolsmith reduces to tool-forging approval
and curation; command-steering owns the PreToolUse hook and steers agents away from
dangerous/problematic commands toward better ones — which may or may not be forged tools.
This document is the single reference the scoped implementation tickets point at.

## The relationship, in one paragraph

**Data flows from toolsmith to steering; control never flows back.** Toolsmith registers
*facts* (detection patterns, approved targets, pinned hashes, grant tuples) into steering's
declarative config through the shared file seam; steering deterministically executes that
config in the hook. Steering knows nothing about tool lifecycle (staged/live, graduation,
signing); toolsmith owns no runtime interception. Steering's dependency arrow points at
nothing above it; toolsmith consumes steering as a registration target.

## Contract surfaces

### 1. Registration (toolsmith → steering)

At admission (attest-it-sealed, human-ratified), toolsmith emits per-tool registration data
steering consumes:

- **Detection patterns** (`covers`) — authored by the curator, shipped with the tool,
  reviewed inside the sealed surface.
- **Approved target** — live path, invocation template (named captures per the
  parameterized-steering design), purpose/rationale for redirect payloads.
- **Integrity pin** — the admitted content hash (sha256 today).
- **Grant tuples** — hash × scope {global | agent-type | session} × expiry.

Seam: version-controlled config files (the registry / steering-config files under
`.claude/`), not APIs. Scope layering (defaults → user → project, project-shadows-user)
follows the shipped #68 semantics.

### 2. Runtime predicates (steering executes, toolsmith supplies data)

On invocation of a **registered target path**, steering evaluates deterministically:

- **Integrity**: sha256 of the resolved file vs. the registered pin. Mismatch → **fail
  closed to `ask`** (the set's cross-project invariant). Defense in depth on top of the
  staged/live split's agent-unwritable live directory: catches out-of-band drift (dotfile
  sync, manual edits) file permissions can't.
  - *Supersedes #44's deny-plus-`# toolsmith:proceed`-marker mechanism.* Same outcome (human
    approves a drifted one-off; fleet never bricked) with fewer moving parts. The marker
    survives, if at all, only for steering's own soft-block UX — not for tamper.
- **Grant tuple**: match scope (agent_type / session_id from the hook payload) and expiry.
  Valid grant → **defer** (the native allow rule runs the tool). No matching/unexpired
  grant → **`ask`**, reason carried in the verdict payload ("granted to agent-type
  code-reviewer only", "grant expired …").
- Steering **never emits `allow`**. Native permission rules are the baseline capability;
  steering only subtracts (deny / ask / defer). The full authority chain: attest-it seal
  (admission) → native allow rule (capability) → steering integrity + grant predicates
  (subtractive runtime enforcement).

### 3. Verdict payloads (steering owns schema, toolsmith fills)

Resolution to the steering brief's open question: steering defines the verdict payload
schema (reason, redirect target, filled invocation, cost signal); toolsmith fills the
redirect-payload fields for its tools at registration time. A registered redirect must be
runnable as-is — the suggested form must match what the native rule actually allowlists (the
#36 §1 deadlock rule).

### 4. The forge affordance (steering → toolsmith, pointer only)

Steering's cost-surfacing verdict ("this costs a human approval every time; nothing covers
it") includes a stable pointer to the forge flow (the toolsmith skill). Steering does not
know how forging works; toolsmith does not know when the pointer fires.

### 5. Telemetry (steering owns, toolsmith reads)

Steering owns the telemetry triangle (invocations+outputs, redirects, asks). The toolsmith
curator/analyze reads it to propose tools. Contract: stable documented schema + location;
read-only for toolsmith; steering must not break readers without a versioned change.

## Ratification path

All registration changes ride the shared flow: proposed as signed changesets in the config
repo, human merge = ratification, deterministic reconciler applies (tool placed live,
executable bit, native rule written, steering registrations activated). Until the
ratification layer exists, the interim mechanism is toolsmith's current `approve` handshake
writing the same artifacts directly.

## Invariants this contract inherits

- Fail closed to asking (verification failure → normal human-approval flow; never silent
  denial/allowance).
- Only humans loosen (registration that widens anything requires human ratification;
  tightening may be unilateral).
- Approval is content-addressed (seals/pins bind exact content; any change voids).
- The steering hook's not-opted-in hot path stays within the measured budget (#38);
  registration data may never add work ahead of the gate's short-circuit.

## Related

- Scoped tickets: #72 (verdict schema), #73 (registered-target predicates), #74 (engine
  extraction), #75 (staged/live), #76 (attest-it admission), #77 (registration emission).
- Dispositions executed at adoption: #44 superseded per §2; #61/#40 (soft-block /
  cost-surfacing) and #41/#42 (rules config / routing) are steering-plugin work; #37 + PR
  #67 steering-spec content transfers into the command-steering canon.
