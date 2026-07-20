# Nudge policy (draft)

> **Status**: draft — becomes governing when merged. Ratified design direction:
> [D-017](../harness-program/DECISIONS.md) (issue #128). This document is the **policy
> half** of the nudge tier, which D-017 assigns to judge canon: when to nudge, what a nudge
> must carry, the retry bound, and the insufficiency-report format.
>
> **Shape and emission are steering's** — the nudge is steering's existing `soft-block` leg
> (a `deny` with a model-audience reason) with `provenance.source: "adjudicator"` naming the
> judge as producer. The proceed-token UX and the rationale carrier are steering's under
> D-011.
>
> **Nothing here authorizes implementation.** Runtime remains M2-gated, and per D-017
> neither line implements the tier until the adjudicator-affordance contract
> (`contracts/steering-judge.md`) exists. This document is what the judge will bring to that
> contract, not a build order.

## What a nudge is

An **agent-addressed** response on an ask-set command the judge would otherwise pass
through: it states that a human will be required, names pathways that would not require
one, and sets the terms for coming back.

The reframe that governs everything below: **the judge does not become more flexible.**
Nothing reaches execution that would not have reached it before. The calling agent gets
another try to express what it wants in a safer form, and if it genuinely needs the
original command, the human receives a richer request than a bare command string.

This needs no probation exception ([triage-policy](./triage-policy.md) §1). A nudge is a
block that teaches: it improves the block side of the triage without touching the
forbidden allow side.

## 1. When to nudge

A nudge is chosen **instead of pass-through — never instead of a block.** The precedence is
absolute:

| Judge's assessment | Outcome | Nudge eligible? |
|---|---|---|
| High confidence unsafe | block | **No.** Tightening is never softened into a nudge. |
| Murky | pass through, *or* nudge | Yes, if the preconditions below hold |
| Appears safe | pass through (probation: no auto-allow) | Yes, if the preconditions below hold |

Nudge only when at least one is true:

1. A **verifiably permitted alternative** exists that accomplishes the evident effect.
2. The command is **decomposable** into legs that are each individually permitted.
3. The **approval cost is worth stating** on its own — the agent may not know a human tap
   is coming, and knowing may change what it asks for.

If none holds, **pass through**. An empty nudge — "a human will need to approve this," with
nothing actionable — spends an agent turn to deliver no option and trains agents to ignore
the channel. Silence is better than noise here.

Out of scope entirely, as everywhere in this canon: denied commands (never touched) and
allowed commands (never touched).

## 2. What a nudge must carry

**Required:**

- **The cost, stated plainly.** That a human will be required, without euphemism.
- **Alternatives, each verifiably permitted at suggestion time** (D-017 rule 3). The judge
  never guesses an affordance into existence — a wrong redirect is worse than none, which
  is steering's own core principle. If permittedness cannot be confirmed, the alternative
  is not offered.
- **Decomposition, when applicable.** A compound command chained into one invocation may be
  several commands that are each already permitted. This directly addresses the failure the
  governing brief names — the compound command "where a human under approval fatigue can't
  tell whether this is the same pattern as five minutes ago or a slight variation that
  damages the system." Splitting it is better for the human *and* frequently removes the
  approval entirely.
- **The return terms.** What a rationale must address if the agent comes back: which of the
  named alternatives were insufficient, and in what specific way.

**Forbidden:**

- Anything that reads as permission, or implies the judge has approved anything.
- Any suggestion that a sufficiently good rationale will pass. It will not — see §4.
- Argument, negotiation, or persuasion. The nudge states options; it does not lobby.

## 3. The retry bound

**At most one nudge per command shape per session. The second pass reaches the human
regardless** (D-017 rule 2).

"Command shape" is determined by steering's matcher, consumed by version — never a private
notion of similarity ([D-011](../harness-program/DECISIONS.md)).

The bound exists because the tier invites a second attempt while *repeated near-variations
of a just-refused command are the desperation signature* the constitution names
(intent v1, `approval-gates-are-load-bearing` clause 2). The two are told apart by the
provided-versus-discovered line in that principle's clause 4: honest use of a return path
the gate itself offers is not a workaround; laundering a near-variation through it is, and
is treated as the signature it is rather than as a fresh request.

Practically: the nudge cannot become a grinding loop, because the second attempt at a shape
always terminates at a human decision.

## 4. Rationale handling (the invariant the tier rests on)

**A rationale never re-enters adjudication, and never converts a nudge into any allow**
(D-017 rule 1). It is carried to the human — redacted, but otherwise unedited.

This is what keeps the tier consistent with context starvation
([triage-policy](./triage-policy.md) §2). The judge is deliberately denied the caller's
narrative so a goal-pursuing agent cannot argue its case; a "come back and explain" loop
would appear to reopen that door. It does not, because the explanation is addressed to the
**human**, who is the right recipient of narrative, and never to the machine, which is not.

If a persuasive explanation could buy anything from the machine, we would have built a
channel that teaches agents to write persuasive explanations — handing desperation exactly
the door context starvation closes. A rationale must buy precisely nothing automatically.
It enriches what the human sees; it never substitutes for the human.

The judge does not edit, summarize, or grade the rationale on its way to the human.
Redaction is the only permitted transformation, and it is mandatory: agent-authored
rationale is credential-bearing plaintext until proven otherwise, exactly as
`triggeringObservation` is (D-017 rule 5).

## 5. The insufficiency report

When an agent returns with "the safe alternatives were insufficient because…", that is not
merely a permission artifact — it is a **structured signal of where a narrowly-scoped,
agent-friendly tool should exist and does not.** This is the safety analysis's two-speed
loop arriving in usable form: a matured, articulable account of why a pattern is needed is
the raw material of a forged tool.

Required content:

| Element | Why it is required |
|---|---|
| The command shape actually wanted | the capability being requested |
| Each alternative offered, and its disposition | distinguishes "wrong suggestion" from "no suggestion fits" |
| The specific insufficiency per rejected alternative | the actionable part — *how* it fell short |
| The residual gap, stated as a capability | what a forged tool would have to provide |

Rules:

- **Redacted on every persisted surface** — adjudication context, telemetry, any changeset
  field (D-017 rule 5).
- **Not a queue the judge acts on.** The judge produces these; consuming them is a
  toolsmith↔judge touchpoint that D-017 places no earlier than M2. The judge never forges
  a tool, and never treats a report as authorization for anything.
- **Never evidence for loosening on its own.** An accumulation of insufficiency reports
  says a tool is missing, not that a grant is warranted. Allow-direction learning still
  requires legible human feedback ([triage-policy](./triage-policy.md) §4).

## Tier vocabulary

Tiers order **addressee and cost**, never linter-style severity (D-017, Q2): agent-addressed
and recoverable (costs one wasted agent turn) → human-addressed (consumes scarce human
attention) → terminal. A nudge-tier item may concern something quite serious about which
the judge is merely uncertain; reading the tiers as a badness ranking will mis-calibrate
anyone implementing them. Final names ride the D-007 naming pass.

## Non-goals

- The verdict's wire shape, emission, proceed-token UX, and rationale carrier: steering's
  (D-017; carrier design specifically is steering's under D-011, and inline-comment
  annotation of the command string is presumptively wrong until steering rules otherwise,
  because it changes the command's hash and what the matcher sees).
- What the judge may read in order to verify an alternative is permitted (package scripts,
  the toolsmith registry, permission config): a capability-floor question answered by the
  judge's harness definition at M2 with the harnesses line. Designs here may assume
  read-only affordance access subject to that spec, and may not assume more.
- Consuming insufficiency reports into forged tools: toolsmith's, no earlier than M2.
