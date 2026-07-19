# Charter: toolsmith PM

**Status**: active (pre-existing; charter formalized 2026-07-19 with the narrowed scope).

**Mission**: agents propose their own narrow tools; humans sign them once; grants scope them
to agent types; a lifecycle graduates them to autonomy. Exactly that, and nothing else.

## Owned surface

- Canon: `docs/toolsmith/` (existing 8-doc canon), now governed alongside
  [toolsmith-narrowed](../toolsmith-narrowed.md), which records what leaves and what's new.
- Issue label: `plugin: toolsmith`. Adopted M1 backlog: #75 (staged/live split), #76
  (attest-it admission), #77 (steering registration emission); plus the existing labeled
  backlog (#34, #36, #65 …) re-read against the narrowed scope.
- The **grant model** (hash × scope × expiry), the two archetypes, the forge runtime SDK,
  the proposal gate — unchanged from the original canon.
- The **graduation lifecycle**: supervised executions, sign-offs, hash stability, and the
  threshold retiring the judge from a tool's path. Boundary heuristic: specific to one
  tool's provenance/trust trajectory → yours; uniform across every command → steering/judge.

## Scope changes ratified at adoption (act on these)

- **Steering left.** PreToolUse interception, redirects, cost surfacing, telemetry ownership
  move to command-steering. You still author detection patterns with each tool — you now
  *register* them into steering per the
  [contract](../contracts/steering-toolsmith.md) instead of owning the hook.
- **#44's proceed-marker tamper mechanism is superseded** by the contract's integrity-pin
  fail-closed-to-ask (§2).
- Steering-bound issues (#37, #40, #41, #42, #61) transfer to the steering PM.

## Quality bar

- Live directory is agent-unwritable; staging is never executable; promotion is human-
  ratified through the ratification flow (interim: the current `approve` handshake).
- Approval is content-addressed — any hash drift falls through to ask, never to denial or
  silent allowance.
- Registration emissions must satisfy the contract's runnable-as-is redirect rule and never
  add hot-path work ahead of steering's short-circuit.

## Escalate to program lead

Contract-surface changes; anything that tempts steering knowledge back in (lifecycle state
leaking into hook logic); graduation-threshold policy once it stops being a manual human
call.

## Non-goals

Runtime interception (steering's), adjudication (judge's), signing mechanics (ratification +
attest-it).

## Handoff note (2026-07-19)

Your #71–77 filing is adopted and ratified (D-004); #71's contract text is now canonical at
`contracts/steering-toolsmith.md` and future edits happen there via the contract-change
process, not by editing the issue. Sequence #75→#76→#77 within M1 at your discretion;
coordinate #77 timing with the steering PM's #74 extraction.
