# The judge: adversarial triage for the ask set

> **Status**: adopted into the harness program canon 2026-07-19 (moved from the original brainstorm drafts). Governs fleet work per [README](./README.md).


Mike North · 2026-07-18

One of six companion docs. Start with [How the pieces fit](./how-the-pieces-fit.md). Companion primitives: [command steering](./command-steering.md) (the deterministic layer the judge writes into), [the changeset layer](./changeset-layer.md) (how its decisions get ratified), [attest-it](./attest-it-substrate.md) (how its identity signs).

> **[NEEDS INPUT]** "The judge" is a working name.

## The problem

Two failure classes get through per-command human review, and they're not the ones the security literature worries about:

1. **Accidents.** A well-intentioned agent passes an environment variable that was supposed to hold a folder name to `rm` — and it's empty, so `rm -rf /` with nothing after the slash. Or it composes a huge compound command where a human under approval fatigue can't tell whether this is the same pattern as five minutes ago or a slight variation that damages the system.
2. **Desperation.** An agent debugging its way through a problem starts exhausting its best ideas and escalates. A GitHub check gets marked not-required because the agent had CLI access and the goal was "get this merged." A git remote gets switched from SSH to HTTPS because the agent found a token intended only for the MCP server — routing around the Touch ID gate that was deliberately placed on my GitHub identity via 1Password. No malice. Total goal-pursuit. Boundary defeated.

We are explicitly **not** defending against malicious use or prompt injection here. We're preventing productive, well-intentioned agents from making mistakes — and pushing back when goal-pursuit turns into locally-rational workarounds a human would veto on sight.

## What the judge is

A reasoning agent in its own dedicated harness that operates **purely on the ask set** — the commands the harness's tool-use permissions mark `ask`. Denied commands stay denied; allowed commands run; the judge never touches either. It is a layer of intelligence *before* the human receives a permission request:

- **Thumbs up** when things appear safe → the request never reaches the human.
- **Thumbs down** when there's high confidence something is unsafe → blocked, immediately, without waiting for a human.
- **Pass through** when it's murky → the normal ask flow, which is exactly where human judgment belongs.

That thins the ask pile from both ends, and the ask pile is what causes permission fatigue in the first place.

## Adversarial by design, context-starved by design

The judge runs with an adversarial mindset and deliberately **without the caller's context** — it doesn't see the calling agent's narrative, its approaches already tried, its accumulated frustration. Desperation can't leak in and argue its case. What the judge *can* see is command history, which makes escalation patterns detectable rather than hidden: the drift toward riskier attempts is visible from the outside even when each individual command looks plausible.

## Intents, and the ratchet

The judge's harness holds a **versioned intent document** — numbered principles like "SSH is always my credential type when engaging with GitHub." Stating an intent is easy. Enumerating every pathway that violates it is not: the remote URL swap, an edit to my SSH config, a git config trick, a DNS override somewhere so that "github.com" isn't. Nobody can write that list up front.

So the judge is a **discovery mechanism**, not a permanent runtime gate. It starts on the reasoning path because the violating pathways are unknown. Every real attempt it catches becomes a candidate for a rigid, deterministic rule crystallized into [command steering](./command-steering.md) config. The reasoning surface shrinks as coverage accumulates; the expensive judge is left working the residual long tail. Expensive reasoning up front, converging into cheap deterministic artifacts — the same shape as the Toolsmith bet.

## Asymmetric authority

- **The judge can unilaterally tighten.** Seeing something scary, it can put a wall up immediately, no human approval — restricting is always safe, because everything degrades to asking.
- **The judge can never unilaterally loosen.** Opening a capability is where the human hardware signature lives, full stop. Collapsing this would quietly hand the judge the one power the whole system deliberately withholds.

## Decisions, staged and ratified

Judge decisions persist in a deterministic layer between the hook config and the judge itself — proposed, not yet official. Promotion into the harness's real permission config (`settings.json` for Claude Code) is a human act: a PR merge in the config repo, carried as a signed changeset (see [the changeset layer](./changeset-layer.md)). This cleanly disambiguates the judge's judgment from the user's decision to ratify it. While unpromoted, the judge keeps enforcing its decision on the reasoning path; ratification is what retires that recurring cost.

## The judge's identity

The judge gets its own signing keypair. We're at a transitional point where agents aren't fully independent actors but aren't just tools either — I'm still accountable for what merges, and everything currently speaks with my one SSH key. The judge signing its own proposals gives us:

- **Provable authorship.** A CI check enforces that config-change PRs carry the judge's signature. A desperate coding agent that discovers "open a PR against the config repo" as a workaround can't produce that signature — the attempt is *visible* instead of indistinguishable from legitimate proposals.
- **Authorship, not endorsement.** The signature means "this proposal legitimately came from the judge," never "the judge vouches this grant is safe." Safety-vouching for loosening is reserved for the human tap. For tightening, authorship and safety point the same way anyway.
- **Structured risk communication.** The judge fills a template in the changeset it signs — necessary evil vs. low concern, factors weighed — so the human reads a judgment that provably came from the judge, unedited, and ratifies authenticity plus stated risk rather than adjudicating a raw config diff cold. A trust-router for human attention.

Mechanically this is just attest-it: the judge is a signer enrolled in the team, authorized for the config-change gate and only that gate.

## Second deployment: the tool-development harness

Toolsmith drafts can't execute from staging (see [Toolsmith, narrowed](./toolsmith-narrowed.md)). The judge's second seat is a dedicated tool-development harness where it sits on the critical path of *every* execution: the tool-building agent states what it believes a command does, and the judge adjudicates the command against that stated intent. Expensive and slow — placed exactly where latency doesn't hurt, because tool development is already out-of-band. The human's eventual signature on the finished tool is what earns the per-execution cost back.

## Non-goals

- Not a runtime gate on allowed commands, and never involved with denied ones.
- Not an anti-malice or anti-prompt-injection system. Accident prevention and desperation pushback only.
- Not the permission engine — steering enforces; the judge proposes and adjudicates.

## Open questions

- **Is there a quantifiable risk signal?** Today the changeset template carries qualitative judgment. If a calibrated risk level ever becomes justifiable, the channel already exists — but I don't yet know what would make such a number honest.
- **How much command history does the judge see, and across what boundary?** Escalation detection needs enough window to see drift; the right scope (session, day, agent type) is undecided.
- **What confidence bar justifies auto-allow?** Auto-block is cheap to get wrong (it degrades to asking). Auto-allow is the dangerous direction of the triage and probably wants a much higher bar, or a probation period where the judge only blocks and passes through.
