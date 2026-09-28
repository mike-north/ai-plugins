# Toolsmith v2: the steering layer — permission posture, verdict log, rules config, ask-cost surfacing, fatigue, and latency budget

Mike North · 2026-07-18

Companion docs: [Architecture steer](./architecture-steer.md), [Product framing and principles](./product-framing-and-principles.md), [Steering & gap-adjudication](./steering-adjudication.md), [Design patterns](./design-patterns.md), [The toolsmith CLI surface](./cli-surface.md).

## What this specifies

The canon asserts a steering layer and then stops. Three lines claim it as design — `product-framing-and-principles.md:54` ("surface cost; soft-block, never hard-block"), `architecture-steer.md:49` ("the pre-hook logs its own redirects and asks … the full telemetry triangle"), and `prfaq.md:30` ("blocking is reserved for redirects") — but none is specified well enough to implement against, and the pre-hook today writes nothing at all (a grep of `toolsmith-gate.sh` and `toolsmith-check.mjs` for any append returns zero, so the telemetry triangle has two legs, not three).

This document is that specification. It fixes, each as a named section a reviewer can cite:

1. **The steering layer's permission posture** — the exact `allow`/`ask`/`deny`/defer contract, and the single invariant that bounds it (§1).
2. **The pre-hook verdict log** — path, NDJSON schema, rotation, self-gitignore, and the secret-plaintext warning (§2).
3. **The `steering` rules config** — a section of the existing `config.json`, its schema, and its project/user precedence (§3).
4. **Ask-cost surfacing** — which settings files are read, the deny > ask > allow precedence *as an explicit approximation*, and the worked `git tag` example (§4).
5. **The single nudge surface and fatigue policy** — covering both ask-cost nudges and watchlist `rationale` nudges, resolving #36 §3's open question (§5).
6. **A latency budget with numbers** — for the not-opted-in, opted-in-miss, and opted-in-hit paths, backed by #38's benchmark (§6).

### Scope: what this owns, what it defers

[Steering & gap-adjudication](./steering-adjudication.md) owns the *shape* of a steer — the three legs (subset/gap/no-cover), the tiered template→adjudicator→floor mechanism, and the parameterized invocation. This document owns the *substrate* that layer runs on: the log it writes, the config it reads, the cost signal it surfaces, the fatigue it must not cause, and the latency it must not exceed. Where the two meet — the no-cover soft block, the `# toolsmith:proceed` marker — this document states the substrate rules (what is logged, how the `ask` set is resolved) and defers the leg's return contract to steering-adjudication.md rather than restating it.

It does **not** specify: the implementation of any of this (logging #39, ask-cost surfacing #40/#61, rules #41, routing #42 are separate); the registry schema or the approval/signing lifecycle (`registry-schema.md`, unchanged); or vaultkeeper's API (an external boundary the canon does not define).

## §1 — The steering layer's permission posture

The permission system is the security boundary. Steering's job is to make the *right* call cheaper to reach, never to make an *unsafe* call for the human. That reduces to one invariant, stated as `product-framing-and-principles.md:36` states it for the hook generally — "failure degrades to asking, never to silent denial or silent allowance" — and as safety invariant 1 of steering-adjudication.md states it for the adjudication path:

> **The steering layer never emits `permissionDecision: allow`.** An LLM is not the security boundary for prompt-injection-adjacent input. Grants produce `allow` (that is the enforcement path of the two approvals, `product-framing-and-principles.md:36`); *steering* only ever produces a richer `deny`, a richer `ask`, or a defer that returns the command to the harness's own flow.

> **Note — supersedes the "advisory-only, never deny" framing.** An earlier phrasing of this layer (and the original wording of issue #37) held that steering is "advisory-only — never `deny`." That is not the ratified design. `deny` **is** a steering verdict; it is `allow` that steering may never emit. `product-framing-and-principles.md:54`, `prfaq.md:30`, and steering-adjudication.md were reconciled to this in the v2 canon pass, and this section is the normative statement of it. The distinction matters because two of the layer's most valuable behaviors — the redirect and the soft block — are denies.

`deny` is reserved for exactly three cases. Every other outcome is a defer (return nothing; the harness runs its normal permission flow):

| Case | Trigger | Verdict | Escape hatch |
|---|---|---|---|
| **Redirect** | A watched command matches an **approved** tool's `covers`. | `deny` naming the tool (a filled invocation per steering-adjudication.md's tiers). | None — the tool *is* the sanctioned path. Take it. |
| **Soft block** | A command in the effective `ask` set (§4) that **no** approved tool's `covers` matches. | `deny` surfacing the cost, pointing at `/toolsmith`, and warning against circumvention. | Trailing `# toolsmith:proceed` marker → the hook **defers**; the harness's own `ask` prompts the human, who approves the one-off as normal. |
| **Tamper** | A registered tool is invoked whose script hash no longer matches its pinned `approvedSha256` (or is unapproved). | `deny` — the pin is the whole point of "sign what executes". | Trailing `# toolsmith:proceed` marker → the hook re-attempts as an explicit **`ask`** (not a defer — see below), so the human approves the drifted script for one run without re-pinning it. |

**The marker downgrades to different targets by case, and this is deliberate.** For a *soft block*, the blocked command sits at `ask` in the harness config, so a defer is correct: the marker lifts toolsmith's block and the harness's own `ask` rule prompts the human. For *tamper*, the tool sits behind a `Bash(<path>:*)` **allow** rule that the approval added — so a defer would let that stale allow auto-run the tampered script with **no** human review, defeating hash-pinning entirely. The tamper escape hatch therefore returns an explicit `ask`, which overrides the allow rule for that one invocation. Same marker, same deny-default spine, different downgrade target dictated by whether the command sits at `allow` or `ask`. One marker mechanism serves both (do not build two); the case determines whether the marked re-attempt defers or asks.

In every case the hook never emits `allow`, and a marked command's *leading tokens are unchanged* (the marker is a trailing comment), so the harness's own permission matcher still classifies the command exactly as it would without the marker. The marker can lift toolsmith's block; it can never approve a command on the human's behalf. (Steering-adjudication.md safety invariant 7 states the soft-block half of this; this section extends the same guarantee to tamper.)

The tamper deny-default is a change from the plugin's shipped 0.3.x behavior, where a hash mismatch fell through to `ask`. The rationale for deny-default: a silent `ask` on a drifted critical tool trains the fleet to click through, whereas a deny with a legible reason ("this tool's contents changed since approval; re-approve with `/toolsmith:approve`, or re-run with `# toolsmith:proceed` for a reviewed one-off") steers toward re-pinning. It is deny-*default*, not deny-*hard*, precisely so a legitimately-edited tool is never bricked fleet-wide with critical commands going quietly dead.

## §2 — The pre-hook verdict log

The third leg of the telemetry triangle (`architecture-steer.md:49`). It reuses the conventions `toolsmith-log.sh` already established for `history.jsonl` (`registry-schema.md`, "history.jsonl") rather than inventing a fourth log format.

**It is a verdict log, not a command log.** `history.jsonl` already records one line per Bash call (the PostToolUse leg: what *ran*). This log records one line per **steering decision the pre-hook actually made** — a redirect, a soft block, a tamper deny, or an ask-cost surfacing — and nothing on the defer/pass-through path. A command the hook lets through untouched is not a steering event and is not logged here (it is already in `history.jsonl` if it ran). This keeps the log small, keeps the not-opted-in path write-free (§6), and makes redirect volume — the "semantic activation defect signal" of `product-framing-and-principles.md:54` — directly countable.

| Property | Value | Consistent with |
|---|---|---|
| Path | `<projectRoot>/.claude/toolsmith/steering.jsonl` | `history.jsonl` sits in the same dir |
| Format | NDJSON, one object per steering event | `history.jsonl` |
| Self-gitignore | The hook writes/refreshes `.claude/toolsmith/.gitignore` with a `steering.jsonl` line (the dir's `.gitignore` already lists `history.jsonl`) | `toolsmith-log.sh` writes the gitignore |
| Rotation | > 2000 lines → retain the most recent 1500 | `toolsmith-log.sh`'s exact policy |
| Write posture | Best-effort; a write failure **never** changes the verdict and emits no stderr | #39 AC4; `product-framing-and-principles.md:36` |
| Scope | Project-local only (like `history.jsonl`); no user-level aggregate log — cross-project rollup is `toolsmith analyze`'s job over the user-level project index (`cli-surface.md`) | `history.jsonl` is project-local |

Field schema (each field present on every line; `null` where a field doesn't apply to the verdict):

```json
{
  "ts": "2026-07-18T15:12:22Z",
  "verdict": "redirect | soft-block | tamper | ask-cost",
  "command": "gh api repos/o/r/pulls/1/comments",
  "tool": "gh-pr-reactions",
  "reason": "ask-set match, no covering tool"
}
```

- `ts` — UTC `%Y-%m-%dT%H:%M:%SZ`, exactly as `toolsmith-log.sh` stamps it.
- `verdict` — one of the four steering events above.
- `command` — the raw command string that triggered the event. **This is the same plaintext-secret hazard `history.jsonl` carries** (a command may embed `-H "Authorization: Bearer …"`): the file is local and gitignored but plaintext, so `.claude/toolsmith/` is sensitive and must not be copied elsewhere. The secret-warning note in `registry-schema.md` applies verbatim and MUST be repeated in this log's schema doc.
- `tool` — the forged tool named in a redirect, or `null` for soft-block/tamper/ask-cost.
- `reason` — a short machine-stable slug (not the human-facing prose), so `analyze` can aggregate by cause.

The log is written by the pre-hook (`toolsmith-check.mjs`) at the point it decides a non-defer verdict — inside the node process that is *already running* for opted-in projects, so it adds no new process spawn (§6). It is never written by the fast-path gate (`toolsmith-gate.sh`), which exits before spawning node on the not-opted-in path.

## §3 — The `steering` rules config

Steering rules live in a **`steering` section of the existing `config.json`** (`registry-schema.md`, "config.json"), which already carries `watchlist` — not a new file. This closes the user-scope `config.json` gap #36 §3 raises: the section exists in **both** scopes with the same project-shadows-user precedence the registry and watchlist already use.

```json
{
  "watchlist": { "add": ["…"], "remove": ["…"] },
  "steering": {
    "askCost": { "enabled": true },
    "fatigue": { "mode": "once-per-session" },
    "rules": [
      { "match": "(^|[|&;( ])terraform\\s+(apply|destroy)\\b", "rationale": "Terraform mutations are reviewed; forge a plan-scoped tool.", "nudge": true }
    ]
  }
}
```

Schema:

- `askCost.enabled` (boolean, default `true`) — whether the ask-cost soft block (§4) is active for this scope.
- `fatigue.mode` (enum, default `once-per-session`) — the fatigue policy of §5; one value governs both nudge sources.
- `rules[]` — each rule pairs a `match` (a JavaScript RegExp string, tested against the raw command exactly as `watchlist` and `covers` patterns are, via the existing `toRegExp`/`safeTest` machinery) with a `rationale` (the human-facing reason surfaced in the nudge — this is #36 §3's watchlist `rationale`) and a `nudge` flag. Rules add *reasons* to the nudge surface; they never widen or narrow the permission verdict (§1).

**Precedence.** Resolution follows `design-patterns.md:43`'s standard order — flags > env > project config > user config — with project shadowing user per the shared-contract table in `registry-schema.md`. Concretely: the effective `steering` config is the user-scope section overlaid by the project-scope section (project keys win); `rules[]` from both scopes are concatenated (a project rule and a user rule can both fire). `askCost.enabled` and `fatigue.mode` are single-valued and take the project value when present, else the user value, else the default.

**Malformed → fail-open.** An unparseable `config.json` in either scope is treated as absent for that scope only — steering silently disarms there, no stderr — exactly as `registry-schema.md`'s "Malformed files" rule already specifies for the watchlist. A JSON syntax error must never harden into a block.

## §4 — Ask-cost surfacing

The cost signal is *"this command requires per-invocation human approval"*, derived deterministically from the harness permission config — **the commands the user set to `ask` are, by definition, the ones that will cost an approval** (`architecture-steer.md:45`, `product-framing-and-principles.md:54`). No separate curated cost list exists to drift.

**Settings files read, in precedence order** (the harness's own order for permission rules):

1. `<projectRoot>/.claude/settings.local.json`
2. `<projectRoot>/.claude/settings.json`
3. `<home>/.claude/settings.json`

A rule in an earlier file wins over a later one for the same command. The hook resolves an **effective `ask` set** = commands matched by an `ask` rule and **not** suppressed by a more-specific `allow` rule in an equal-or-higher-precedence file.

**This resolution is an explicit approximation, not a reimplementation of the harness matcher.** The spec states this as a first-class property, not an apology: a false-positive soft block is a harmless nudge the agent clears with one `# toolsmith:proceed` marker, so precision effort beyond "most-specific rule wins, deny > ask > allow" is effort the failure mode does not justify. The hook must not attempt to be byte-identical to the harness's internal matcher; it must be *good enough that the common cases are right and the rare miss is cheap*.

**Worked example — `git tag` (the make-or-break case).** A real config carries both:

```json
"allow": ["Bash(git tag:*)"],
"ask":   ["Bash(git tag -d:*)", "Bash(git:*)"]
```

`git tag v1.2.3` matches the `ask` rule `Bash(git:*)` — but the more-specific `allow` rule `Bash(git tag:*)` suppresses it, so `git tag v1.2.3` is **not** in the effective `ask` set and **does not soft-block**. `git tag -d v1.2.3` matches the more-specific `ask` rule `Bash(git tag -d:*)`, which no `allow` overrides, so it *is* in the set. A named regression test asserts both: `git tag v1.2.3` stays silent, `git tag -d …` surfaces cost. This is the criterion that proves the deny > ask > allow / most-specific-wins approximation is implemented, not merely claimed.

Ask-cost surfacing composes with the three-legs table of §1: a command in the effective `ask` set that a tool covers → redirect (leg 1); in the set, uncovered → soft block (leg 3a); not in the set → defer, never blocked (leg 3b). Pattern density from the verdict log (§2) and `history.jsonl` decorates the reason ("something similar ran 42 times in the last six hours", `architecture-steer.md:45`) but never changes which leg fires.

## §5 — One nudge surface, one fatigue policy

There are two sources of nudge: the ask-cost soft block (§4) and the watchlist `rationale` (#36 §3, now the `rules[].rationale` of §3). They share **one** surface and **one** fatigue policy — the spec's answer to #36 §3's open question (*"`ask`-with-reason, a one-shot-per-session speed bump, or something else?"*).

**Decision: one nudge per distinct command signature per session, governed by `fatigue.mode` (default `once-per-session`).** A "command signature" is the command with its dynamic arguments normalized out (the same normalization the redirect template uses to extract captures, steering-adjudication.md Tier 1) — so `gh api …/pulls/1/comments` and `gh api …/pulls/2/comments` are one signature and nudge once, not twice. After the first nudge for a signature in a session, subsequent matching commands in that session:

- **soft block / redirect / tamper** still return their `deny` verdict (the *permission* behavior never fatigues — safety does not decay), but
- the human-facing *reason* drops the full teaching preamble and carries only the one-line pointer, so the agent isn't re-lectured.

The session key is the harness `session_id` from the hook payload (present on Claude and Codex; `prfaq.md:45`, "grants key off the `session_id` … fields present in hook payloads"). Fatigue state is ephemeral per session — it is derived from the verdict log (§2), which already records each nudge with its signature, so no separate fatigue store is introduced; a signature already present in this session's log lines is in its "already nudged" set. `fatigue.mode: always` disables the speed bump (every occurrence gets the full reason); `once-per-session` is the default.

The one-nudge-per-signature minimum is what #61 implements as its minimal first cut ("a command already carrying the marker is never soft-blocked"); this section is the fuller policy #61 defers to #37, and the two must not diverge — the marker-carrying command is simply the degenerate case (its signature nudged, so it defers).

## §6 — Latency budget

`design-patterns.md:49` rejects latency *theater* for forged tools; it says nothing about the hook, and the hook is exactly where a per-Bash-call tax lands. This section states the budget the canon lacked, as a measurable assertion per path, calibrated by #38's benchmark (`plugins/toolsmith/scripts/bench.sh`).

| Path | What runs | Budget (p95) | #38 measured (this-machine reference) |
|---|---|---|---|
| **not-opted-in** | `toolsmith-gate.sh` stat-exits; **no node spawn, no log write** | ≤ 3× the fork/exec floor, and no adapter/extra spawn on this path — ever | ~13 ms (≈ 5–6 ms above the bare fork/exec floor) |
| **opted-in-miss** | node brain runs, no redirect, one verdict-log line only if it surfaced cost | node startup dominates; the steering work itself adds no new spawn | ~115 ms (node startup ~90 ms + resolution) |
| **opted-in-hit** | node brain runs, emits a redirect/soft-block, writes one verdict-log line | same envelope as opted-in-miss | ~116 ms |

The load-bearing assertion is the **not-opted-in** path: it is the one path whose entire reason for existing is that it is near-free for shells that never opted into toolsmith, and it is the path #34's adapter-adoption question turns on. #38 measured that prepending `hooks/payload-adapter` (sh+jq) roughly **doubles** this path's latency (~13 ms → ~26 ms p50), which is why adapter adoption is **declined for this hot path specifically** (the PostToolUse logger and the Stop hook, not on a hot path, are unaffected and #34 covers them as written). The budget therefore includes a hard sub-rule: **nothing may be added ahead of the gate's stat-exit on the not-opted-in path** — not the adapter, not a config read, not a log write.

Absolute numbers are machine-dependent (the reference figures are from a sandboxed dev environment where bare fork/exec already costs ~7 ms); the budget is expressed as ratios and "no new spawn" invariants that hold across hardware, not as hardcoded millisecond literals. `bench.sh` asserts the not-opted-in p95 against a derived ceiling on the machine it runs on; it is a dev tool, not a CI gate, because wall-clock perf is noisy under CI schedulers.

## §7 — Traceability

Each acceptance criterion of #37 maps to one section above, and each section's claims trace to a named canon line or issue:

| #37 AC | Section | Primary traces |
|---|---|---|
| 1 — advisory posture, security boundary preserved | §1 | `product-framing-and-principles.md:36`; steering-adjudication.md safety invariants 1, 7 |
| 2 — pre-hook log fully specified | §2 | `toolsmith-log.sh`; `registry-schema.md` (`history.jsonl`); #39 AC4; `architecture-steer.md:49` |
| 3 — `steering` config, both scopes, precedence | §3 | `registry-schema.md` (`config.json`, shared-contract table); `design-patterns.md:43`; #36 §3 |
| 4 — ask-cost surfacing, `git tag` example | §4 | `architecture-steer.md:45`; `product-framing-and-principles.md:54` |
| 5 — one nudge surface, one fatigue policy | §5 | #36 §3; `prfaq.md:45`; steering-adjudication.md Tier 1; #61 |
| 6 — latency budget with numbers | §6 | #38 (`bench.sh`); #34; `design-patterns.md:49` |
| 7 — every claim traceable | §7 | this table |

> **AC1 reconciliation, restated for the reviewer.** #37's issue text (AC1 and the "tamper contradiction is undecided" non-goal) predates the v2 canon reconciliation. This spec encodes the ratified design: steering never emits `allow` (not "never `deny`"), and the tamper `ask`-vs-`deny` question is **decided** — deny-default with the `# toolsmith:proceed` → `ask` escape hatch (§1). The issue's AC1 wording and that non-goal should be updated to match; that is a one-line issue edit, flagged separately, not a change to this spec.

## Non-goals

- **Implementation.** Logging (#39), ask-cost surfacing (#40/#61), rules (#41), and routing (#42) are filed separately and depend on this spec; per "specs govern", they should not start until it lands.
- **The registry schema or the approval/signing lifecycle** — `registry-schema.md` is unchanged.
- **Vaultkeeper's API** — an external boundary the canon does not define.
- **The steer *shape*** — the three legs, the tiered template/adjudicator mechanism, and the parameterized invocation are steering-adjudication.md's, not restated here.
- **Byte-identical harness-matcher parity** — §4 is deliberately an approximation; a false-positive soft block is a cheap, marker-clearable nudge, not a correctness defect.
