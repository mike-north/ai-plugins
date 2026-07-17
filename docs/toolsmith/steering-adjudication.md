# Toolsmith v2: parameterized steering and gap-adjudication

Mike North · 2026-07-17

Companion docs: [Architecture steer](./architecture-steer.md), [Product framing and principles](./product-framing-and-principles.md), [Design patterns](./design-patterns.md), [The toolsmith CLI surface](./cli-surface.md). This is a v2 design extension of the steering behavior those docs already describe.

## What this fixes

Today's redirect names a tool but leaves the agent to re-derive the arguments from the command it
just had denied. [Architecture steer](./architecture-steer.md)'s "Hooks: steer, don't block" section
describes the mechanism as-is: "**Redirect** when high-confidence detection says a forged tool already exists
for this pattern." That's a pointer, not an invocation — the agent still pays a semantic-activation
tax re-deriving the call, the exact tax `product-framing-and-principles.md:56` names when it calls
redirect volume "a *semantic activation* defect signal." This doc turns the pointer into a **drop-in
invocation**, adds a real answer for the *partial-fit* case — the agent wants slightly more than the
covering tool gives, the case `architecture-steer.md:55` names as "the real case that forced this
framing: a repo where emoji reactions on review comments carry meaning" — and does both without ever
letting an LLM auto-approve a raw command.

## Scope: what this feeds, what it doesn't replace

This doc specifies three things: the exact hook-return contract for each of three cases (subset, gap,
none), the tiered mechanism that turns a matched tool into a runnable invocation, and the split-model
async path that resolves genuine capability gaps without blocking anyone. It **feeds the steering spec
(#37) and extends the routing issue (#42)** — it does not replace either. #37 additionally owns the
pre-hook log schema, the `steering.rules` config format and its project/user precedence, the harness
`ask`-list resolution and precedence, and the shared nudge/fatigue policy covering both ask-cost
advisories (#40) and watchlist `rationale` nudges (#36 §3); a **latency budget with numbers** for the
not-opted-in, opted-in-miss, and opted-in-hit paths is also #37's job, sharpened operationally by #38's
benchmark harness. This doc assumes all of that exists and doesn't restate it. Where a mechanism here
needs a durable record (the evolution-request log, below), it explicitly reuses those conventions
rather than inventing a fourth log format.

#42 already covers the case where a tool's `covers` fully matches a watched command and denies with a
named redirect. This doc's *subset* leg is that same case, upgraded from a named pointer to a filled
invocation; its *gap* leg is what #42 doesn't yet answer: partial coverage.

## Three legs — exact hook behavior per case

- **Subset** (a tool's contract fully covers the attempt): `deny` + the **filled invocation** to run
  instead — the Tier 1 template if it fills validly, else the Tier 2 AI-derived form. This upgrades
  today's static hint to a runnable line. The suggested form **MUST** match what the tool's grant
  authorizes — the deadlock `#36 §1` documents in detail: a redirect suggesting a relative path that
  doesn't resolve under the session's `CLAUDE_PROJECT_DIR`, or a form the `permissionRule` doesn't
  actually allowlist, blocks the broad command and makes every suggested alternative wrong too. The
  `permissionRule` field and its project/user resolution rules are specified in
  `plugins/toolsmith/skills/toolsmith/references/registry-schema.md`; this doc's invocation-filling
  never diverges from that resolution.
- **Gap** (a tool covers most of the intent; the agent wants more): `ask` + a decorated reason —
  *"`<substitute>` is approved and covers the comments — use it now if you don't need `<the extra>`;
  otherwise this is a legitimate one-off, and a request to teach `<tool>` about `<the extra>` has been
  queued."* The human approves the raw one-off on its own merits; the agent may take the substitute
  immediately if the extra capability wasn't actually essential to the task at hand.
- **No cover / novel**: passthrough (today's behavior), or the steering layer's cost-surfacing
  advisory (#40) when the command matches the harness's `ask` set but no tool's `covers`. Never
  blocked — `prfaq.md:30` is explicit that "blocking is reserved for redirects, where a forged tool
  demonstrably covers the pattern," and `product-framing-and-principles.md:54` frames the alternative
  as surfacing cost, not gating it.

## Tier 1 — deterministic template (in-hook, fast)

`covers` today (`registry-schema.md`) is a bare array of RegExp strings tested against the raw
command. Tier 1 extends each entry from a bare pattern to one carrying **named capture groups** plus
an **invocation template**:

```
"gh\\s+api\\b.*repos/(?<repo>[\\w.-]+/[\\w.-]+)/pulls/(?<pr>\\d+)/comments"
  -> "{tool} --repo {repo} --pr {pr}"
```

Two rules keep this safe:

- **Captures must be narrow classes, never `.+`.** A capture is attacker-adjacent input — it comes
  from a command an agent constructed, possibly itself downstream of injected content — that gets
  echoed straight into a suggested invocation. This is a safety rule today and a candidate future
  entry in the forge rule pack `lint-rule-concepts.md` describes (alongside rules like
  `composition-declares-inputs`, which already constrains what a tool may echo into another
  invocation). **Render-time validation** re-checks each captured value against its declared class
  before templating, independent of whether the pattern matched at detection time.
- **Fallback is mandatory.** If the pattern matches but a capture fails to fill or fails
  render-time validation, the hook emits the **generic redirect** — name the tool, no filled args —
  never a malformed or under-validated suggestion, and never a block. This reuses the existing
  never-throw regex machinery (`toRegExp`/`safeTest` in `toolsmith-check.mjs`) rather than adding a
  parallel, riskier extraction path.

Tier 1's scope is honest: templates fit path-shaped commands (REST-style URLs with positional
segments). Query-body commands — GraphQL, and anything whose parameters live in a body rather than a
path — miss Tier 1 by design and escalate to Tier 2.

## Tier 2 — split adjudicator

On a Tier-1 miss where a tool plausibly covers the intent, the hook dispatches a **headless,
non-interactive adjudicator on the cheapest tier (Haiku-class)** — the CLI's hook-internal
`adjudicate` verb (see [The toolsmith CLI surface](./cli-surface.md)) — with two inputs: the attempted
command, and the tool's contract obtained via **`--explain`** (the contract-without-execution
mechanism `design-patterns.md` specifies). Latency here is acceptable — the counterfactual is an idle
human-approval window, not a hot loop — but the job stays small enough for the cheapest model on
purpose.

**The critical-path job is singular:** classify subset vs. gap, and if subset, emit the substitute
invocation. The verdict shape is:

```
{ verdict: "substitute" | "gap" | "none", invocation?: string, gap_summary?: string }
```

No writes, no tool edits, no approvals happen on this path.

**Why the cheap tier is safe.** The never-`allow` invariant (below) bounds every misclassification to
a benign outcome: a wrong "substitute" verdict costs the agent one wasted turn re-trying; a wrong
"gap" verdict costs the human one unnecessary `ask` that a subset redirect could have avoided. A cheap
model making this call would be indefensible if it could auto-allow a raw command — it's fine
precisely because its worst case is a nudge, not a decision.

**Async, coder-grade (Sonnet-class) evolution dispatch.** On a `gap` verdict, teaching the tool about
the missing capability is its own **async, one-off dispatch** — a stronger model proposes the
modification to the signed tool as a real engineering task, the same way any tool modification
happens: file-editing against the existing script, then the CLI's `lint` gate, then human-gated
`approve` (see [The toolsmith CLI surface](./cli-surface.md), "What is deliberately not a CLI verb"). It is the
same curator remit `architecture-steer.md:55` already describes ("given a problem statement and the
current catalog, it may modify an existing tool") — dispatched headlessly and asynchronously rather
than as the interactive, inline sub-agent spawn `architecture-steer.md:53` describes for a raw-command
miss, because unlike that case, a `gap` classification isn't blocking anyone's turn while it resolves.
The hook returns its `ask` **immediately**, without waiting on this dispatch.

A durable **evolution-request record** under `.claude/toolsmith/` is the source-of-truth backstop for
this dispatch and the surface `toolsmith analyze` (see [The toolsmith CLI surface](./cli-surface.md)) reads when proposing
follow-up work. Its schema and location reuse the existing log conventions rather than inventing a
divergent format: NDJSON, project-local and self-gitignored, the same rotation policy `toolsmith-log.sh`
already implements for `history.jsonl` (`registry-schema.md`'s `history.jsonl` section), and the same
never-blocks-the-verdict posture #39 requires of the pre-hook's own logging (#39 AC4: "a log write
failure never changes the verdict"). The record's write is this doc's application of that same rule:
recording the evolution request can never change the `ask` the hook already returned.

**Floor.** If the adjudicator is unavailable, errors, or times out, the hook degrades to Tier 3.
Fail-open here means the *hint quality* degrades, not the permission verdict — the underlying `deny`-
or-`ask` decision from the three-legs table is unaffected either way.

## Tier 3 — plain-hint floor

Name the tool, its purpose, and a `--explain` pointer, and let the calling agent adapt. This is
today's behavior (`architecture-steer.md:44`'s redirect, as shipped) — the guaranteed floor every
other tier degrades to, never something less reliable than what exists now.

## Forge-time confirmation

At toolbox admission — the first of the two approvals `product-framing-and-principles.md:29-36`
defines — the designer's best-guess capture pattern and parameter mapping are shown to the human to
confirm: *does this URL pattern, and where the parameters are, look right?* The confirmed pattern
ships with the tool inside the reviewed, signed surface, consistent with the contract header
discipline in `design-patterns.md:55`: "one authored artifact, four consumers" — the capture template
becomes a fifth thing the signing review surface covers, not a separate unreviewed inference the hook
makes up at runtime.

## Safety invariants

Each is written to be independently testable:

1. **The steering path never emits `permissionDecision: allow`.** AI auto-approval of a raw command
   is explicitly rejected — an LLM is not the security boundary for prompt-injection-adjacent input.
   This is the same posture `product-framing-and-principles.md:36` states for the hook generally:
   "failure degrades to asking, never to silent denial or silent allowance." Nothing in this doc's
   tiers is exempt from it; a tier can only ever produce a richer `deny` or a richer `ask`.
2. **Captures are narrow-class and render-time-validated.** Extraction failure degrades to the generic
   redirect, never to a malformed or injectable suggestion. This mirrors the existing
   never-auto-execute posture of `forge::suggest`'s did-you-mean (`design-patterns.md:39`,
   `runtime-spec.md`'s §6): a near-miss is surfaced, never silently acted on.
3. **Adjudicator unavailability or timeout degrades to Tier 3.** The permission verdict is never
   blocked waiting on Tier 2; it falls back immediately to the guaranteed floor.
4. **A suggested invocation always matches the form the tool's grant authorizes.** This is the direct
   fix for the `#36 §1` deadlock: a redirect that can't actually be run without hitting another prompt
   is worse than no redirect.
5. **The evolution-request write can never change the permission verdict.** Fail-open, exactly like
   the pre-hook's own logging in #39 (AC4).
6. **The critical-path adjudicator runs on the cheapest tier and performs no side effects; the
   coder-grade model is confined to the async evolution dispatch, off the permission path entirely.**
   This keeps the synchronous piece — the only piece #38's latency budget governs — cheap and fast,
   while the expensive reasoning happens where latency doesn't matter.
