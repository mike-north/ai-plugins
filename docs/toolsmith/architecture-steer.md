# Toolsmith: forged tools and the path to safe agent autonomy

Mike North · 2026-07-15

Companion docs: [Product framing and principles](./product-framing-and-principles.md), [Design patterns](./design-patterns.md), [Forge runtime spec](./runtime-spec.md), [Steering & gap-adjudication](./steering-adjudication.md), [The toolsmith CLI surface](./cli-surface.md). This doc is the place to start.

## The problem

My agents keep reaching for `gh api`.

It's the rational move from their perspective — it's the most general tool available, and whatever they need from GitHub, `gh api` can do it. But `gh api` is configured to `ask` in my tool-use permissions, because autonomous access to the entire GitHub API surface is not something I'm willing to grant. So every invocation lands on me: squint at a command at 11pm, decide whether this particular GraphQL query is safe, approve, repeat. And because reminders don't persist across sessions, I keep telling agents to avoid it, and they keep coming back to it — because from where they sit, nothing structural has changed.

The failure isn't the agent's judgment. It's that the **approval unit is wrong**. Approving `gh api` is approving a capability class; there's no way to say yes to "fetch review comments on this PR, filter with jq, compress with TOON" without also saying yes to "edit branch protection" and "dismiss reviews." Humans are bad at evaluating capability classes one invocation at a time, and permission fatigue guarantees we get worse at it over time.

## Forged tools

A **forged tool** is a small script — usually a shell composition of existing CLI commands — that captures one recurring, narrow usage pattern of a command that's dangerous in the general case. The agent (via a dedicated sub-agent) writes it; a human reviews it once, signs it, and grants usage; from then on the agent runs it autonomously.

The canonical example: `gh-merge`, which performs a merge if and only if all review comment threads are resolved, a Copilot review is in place, all required CI checks pass, the non-required checks pass too, api-extractor reports no public API surface change, and the commit history contains no agent-attribution footers. Every clause is a machine-verifiable precondition enforced *inside* the tool, atomically with the merge — the agent decides *to attempt* the merge; the tool decides whether the merge is *permissible*.

The sentence describing `gh-merge` **is the approval artifact**. "Merge when appropriate" is unapprovable. "Merge iff these seven conditions hold" is a contract you can sign once and let run forever.

## Why narrowness is the feature

The obvious objection: aren't we just building a zoo of tiny wrappers? Yes — deliberately. The narrowness is what makes three things possible that broad access can't deliver:

- **Reviewability.** A 40-line bash script with declared inputs, a contract header, and a named exit code per guard is something a human can actually audit before a YubiKey tap. `gh api` invocations, evaluated one at a time, forever, are not.
- **Policy beyond the platform.** No GitHub branch-protection rule can express "no `Co-Authored-By: Claude` footers anywhere in the commit range." A forged tool can enforce arbitrary local policy at the choke point, immune to drift because the hash pins it.
- **Autonomy that's earned, not assumed.** The human's absence from the loop is the product. The seven guards are why it's fine.

## The two approvals

There are two distinct human approvals in play, and conflating them is the classic mistake:

1. **Toolbox admission** — "this tool is allowed to exist and be executable." The tool's content hash is signed with a private key held in **vaultkeeper** (a separate project: a library over secret backends — YubiKey, 1Password, macOS Keychain, Bitwarden). Signing requires a human action — a YubiKey tap or a 1Password unlock — so an agent cannot admit its own tools, and cannot alter a tool while keeping its approval: modify the script, the hash changes, the signature fails, the tool drops out of the usable set until re-signed.
2. **Usage authorization** — "this agent may run this tool, under these terms." Grants are tuples of tool hash + scope + expiry. Scope can be global, a specific session (`session_id` arrives in every hook payload), or an agent type (`agent_type` arrives in sub-agent contexts). Expiry can be indefinite, time-boxed, or per-invocation. The agent proposes terms; the human adjusts at approval time.

The scoping enables the product stories that make this concrete: *code-reviewer agents can run `gh-merge`; product-manager agents can run `gh-product-sign-off` to flip the "Product approval" check to pass — and neither can do the other's job.* The toolbox becomes a signed, human-ratified role-to-authority map. Organizational design expressed as shell scripts.

## Hooks: steer, don't block

The PreToolUse hook does not hard-block dangerous commands. It does two things:

- **Redirect** when high-confidence detection says a forged tool already exists for this pattern. The detection pattern ships *with* the tool proposal — the sub-agent that forges the tool also defines what the outdated raw invocation looks like, so agent intelligence writes the matcher, not a human guessing at regexes.
- **Surface cost** otherwise: "this command requires per-invocation human approval" (derivable deterministically from the harness's tool-use permission config — anything set to `ask`) plus pattern density from the invocation log ("something similar has been invoked 42 times in the last six hours"). The agent decides whether forging is worth it. Mid-incident at 3am? Take the approval tax. Routine work? Spawn the forge.

Mechanically, the hook returns `permissionDecision: allow` for a valid grant and `ask` otherwise — unauthorized sessions aren't walled off, they just fall back to the normal human-approval flow. Graceful degradation, not a hard edge.

The PostToolUse hook logs invocations *and outputs*, and the pre-hook logs its own redirects and asks. That's the full telemetry triangle: what ran, what got redirected, what got asked. Rising redirect counts mean detection works but semantic activation doesn't — agents reach for the raw command before finding the tool — which is a curation signal to fix naming or the catalog skill, not to tighten blocking.

## The toolsmith sub-agent

Forging is inline, not batch. When the main agent decides a tool is worth building, it spawns the **toolbox curator** sub-agent — shipped with the plugin, opinionated about tool design — and continues its own work in a clean context window. The human can approve the raw command once to unblock the moment, while the forge proceeds in the background so it's never needed again.

The curator's remit is the *toolbox*, not just new tools: given a problem statement and the current catalog, it may modify an existing tool (the real case that forced this framing: a repo where emoji reactions on review comments carry meaning, and the existing comment-fetching tool's GraphQL query and jq filter didn't include them), refactor overlapping tools, adjust detection patterns, or create something new. Agents tolerate an evolving tool surface far better than deterministic callers do — they read `--help`, adapt to new fields, self-correct from legible errors — so we don't carry a versioning regime for tool contracts. (Auditability is a real topic; it is not *this* problem. The user squinting at `gh api` approvals never had it either.)

**Mike North's high-conviction hypothesis**: tool-building is front-loaded. The first 48 hours forge heavily; as coverage accumulates, the curator goes quiet, and the toolbox converges on the fat head of recurring operations while the long tail of exotic one-offs (flipping a branch-protection rule, once) stays on the per-invocation approval path, where it belongs.

## Discovery

Agents can't use tools they don't think of. Discovery is a three-tier funnel: a **toolbox catalog skill** whose description is a scarce ~100-token resource *derived by the curator* from the catalog (naming the primary wrapped commands — `gh`, `curl`, `rm`, `aws` — for semantic activation), whose body is the index; **prefix naming** (`gh-*`, named for the dangerous command the tool retires); and **`--help`** as a token-priced artifact, examples first. The design-patterns doc owns the details.

## Why this matters now

Agents are the forcing function, twice over. First: harness hooks, sub-agents, and permission systems only recently matured to where this architecture is expressible at all — `session_id` and `agent_type` in every hook payload, `permissionDecision` JSON control, agent-type-pinned models. Second: the alternative trajectories are both bad and both already happening — either humans grant broad access to dangerous commands out of fatigue, or agents grind against `ask` walls and burn human attention on unreviewable one-off approvals. Toolsmith is the third path: friction becomes signal, signal becomes tools, tools become autonomy.

## How this relates to adjacent things

- **github-fleet-tools** is the hand-built precedent: five compound, guarded, allowlistable CLIs designed so raw `gh api` could stay gated. Toolsmith is that pattern generalized into a runtime loop.
- **vaultkeeper** owns secrets and grant storage. Toolsmith consumes it; it does not implement key handling.
- **eslint-sh** (proposed, not yet built) is the standalone shell-linting project — an ESLint language plugin over mvdan/sh — that Toolsmith's proposal gate consumes. Toolsmith ships its opinions as a rule pack on top; the dependency points one way. See [lint rule concepts](./lint-rule-concepts.md).
- **Harness wrappers** (e.g. `op run --environment <id>` establishing scoped env + PATH) are trusted infrastructure Toolsmith works within, and they join the signed set.

Multi-user sharing, tool marketplaces, and team curation are explicitly out of scope. We earn the right to those problems by making one user's loop excellent first.

## Open questions

- **Does a sub-agent spawned via Task inherit the parent's `session_id`** (with `agent_id` distinguishing it), or get its own? The docs suggest inheritance, but this determines whether a session-scoped grant covers sub-agents automatically — we should pick deliberately, not discover it. Needs a prototype check.
- **Where's the confidence threshold for redirect vs. cost-surfacing?** Redirecting on a false positive sends the agent to the wrong tool; only surfacing cost forever means the toolbox under-delivers. I don't yet know whether this is a static threshold or something the curator tunes from redirect-outcome telemetry.
- **Can an agent flood the human with tool proposals?** Plausibly, eventually. We treat back-pressure on forging as a problem we have to earn the right to solve.
- **Once the single-user loop is proven, the next question is curation across scopes** — which tools are project-level, which are user-level, and what graduation between them looks like.

## The bet

Toolsmith is a bet that the unit of trust between humans and agents is the **signed, narrow, verifiable tool** — not the model, not the session, not the raw command — and that if we make forging cheap, reviewing honest, and integrity cryptographic, agent autonomy stops being something we nervously grant and becomes something the system accumulates, one contract at a time.
