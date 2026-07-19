# Toolsmith, narrowed: tool forging, signing, and lifecycle

> **Status**: adopted into the harness program canon 2026-07-19 (moved from the original brainstorm drafts). Governs fleet work per [README](./README.md).


Mike North · 2026-07-18

One of six companion docs. Start with [How the pieces fit](./how-the-pieces-fit.md). This doc **revises the scope** of the original Toolsmith steer and its companions ([architecture steer](../toolsmith/architecture-steer.md), [product framing](../toolsmith/product-framing-and-principles.md), [design patterns](../toolsmith/design-patterns.md), [runtime spec](../toolsmith/runtime-spec.md)) — those remain the reference for everything that stays, and this doc records what leaves and what's new.

## What Toolsmith is now

Toolsmith is about exactly one thing: **agents proposing their own tools — scripts — and getting them reviewed, signed, and granted.** Agents identify their own repetitive actions, and we move those into first-order tools safe for autonomous use — in some cases safe for *specific agent types* (a code-review agent that can merge PRs, blocked for every other type). Toolsmith doesn't care why a tool is approved, only whether it is, and for whom.

Everything in the existing docs about forged tools, the two archetypes, the two approvals, the forge runtime SDK, the proposal gate, design patterns, and grants scoped by agent type and session **stands unchanged**.

## What leaves

The **PreToolUse steering piece** — redirect-on-detection, cost surfacing, the telemetry triangle — moves out to [command steering](./command-steering.md), which generalizes it into a programmable permission layer. The curl-to-porcelain and gh-api-to-gh-porcelain nudges proved the point: steering toward a safer existing command has nothing to do with forged tools. The curator still authors detection patterns alongside the tools they point to; it now registers them into steering rather than owning the hook.

The open question about redirect confidence thresholds moves with it.

## What's new: the staged/live split

The original design leaned on hash verification to catch tampering, but it had a lockout problem: propose a formatting fix to a signed tool and the agent is locked out of that tool until a human re-signs — for an hour, or a day. The fix is a git-shaped split:

- **Live** — the signed, executable toolbox. The agent **cannot write here at all**: file permissions lock it out of the directory where executables live. This is a materially stronger boundary than trusting the executable bit, because the everyday risk was never "agent replaces the GitHub CLI binary" (high-effort, noisy, and blocked anyway by denying writes to system bin paths) — it's the agent writing scripts into tool directories, which it does constantly and legitimately as part of forging. The rigor lands exactly where the write activity is.
- **Staging** — where the agent authors new tools and accumulates proposed edits to existing ones. Nothing here is executable. The agent keeps using the last-approved live version the whole time, so there is no lockout; the improvement just waits.
- **Promotion** — a human-ratified merge in the config repo (see [the changeset layer](./changeset-layer.md)), after which a deterministic step pulls latest, places the file in live, and sets the executable bit. Content-addressing makes this the same mechanism as before: live is pinned by its signed hash; staging is a different hash with no grant, which falls through to ask.

## What's new: the tool-development harness

The staging split creates an iteration problem: forging without executing is writing code you can never compile. We rejected the obvious fix — develop in a Docker container — because forged tools are compositions over the real environment: the porcelain commands, the runtime, the actual `gh` and `jq`. A container is either a fragile mirror of my dev box or a test against somewhere the tool won't live.

Instead, the boundary we isolate is **approval status, not location**. Drafts execute in a dedicated tool-development harness where [the judge](./judge.md) sits on the critical path of every execution: the building agent states what it believes a command is doing, the judge adjudicates against that stated intent. Expensive, high-latency, and placed exactly where latency doesn't hurt — tool development is already out-of-band, and it's a far better trade than putting reasoning-heavy command authorization into my normal development flow. The point is accident prevention (the empty-variable `rm -rf /` class), not adversarial defense.

This also opens **monitored near-term use**: a tool can become usable before full sign-off with the judge kept on the critical path of every execution. The human's eventual review and signature is what earns back the latency and cost — it retires the judge from that tool's path.

## Graduation

Toolsmith owns the lifecycle state machine: executions under supervision, sign-offs accumulated, hash stability across them, and the threshold at which the judge comes off the path. The litmus test that settled ownership: would we put the judge in front of a freshly downloaded CLI from GitHub? No — we trust it was built correctly. The judge-on-path phase is a property of *a tool still earning trust*, which makes it a per-tool lifecycle concern, i.e. Toolsmith's. The boundary heuristic generalizes: specific to one tool's provenance and trust trajectory → Toolsmith; uniform across every command regardless of origin → steering and the judge.

## Open questions

- **Does a sub-agent spawned via Task inherit the parent's `session_id`?** Unchanged from the original steer; still needs a prototype check, and still determines whether session-scoped grants cover sub-agents.
- **What are the graduation thresholds?** How many judge-supervised executions, how many sign-offs, and how much hash stability constitute "earned"? I don't yet have numbers; plausibly this starts as a manual human call per tool and only later becomes policy.
- **Once the single-user loop is proven, curation across scopes** — project-level vs. user-level tools and graduation between them — remains the next question, unchanged.
