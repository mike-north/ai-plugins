# Routing evals

These evals prove the `customizations` router makes the **right routing decisions**, and let us
measure whether the routing instructions improve (or regress) as we iterate. Routing is a
*classification* — intent → primitive + scope — so scoring is **deterministic label matching**, not
semantic similarity.

## Pieces

- `routing-evals.json` — the case set. Each case is a natural-language `input` plus the **canonical
  route** (`expected`), a set of `acceptableAlternatives`, a `mustReject` list (the near-miss
  negatives where regressions show first), and `tags` (to slice accuracy by principle —
  `determinism-first`, `cheapest-tier`, `hook-vs-monitor`, `toggleability`, `provenance`, …).
- `score.mjs` — the deterministic scorer (Node, no deps). See `node score.mjs --help`.

## The protocol

1. **Produce blind routed verdicts.** Run the router over each case's `input` **without showing it
   the expected route** (leakage invalidates the run — reuse `skill-evaluator`'s blind test-subject
   pattern: hand a fresh subagent only the `customizations` skill + the `input`, and require it to
   emit a machine-parseable verdict). For variance, do **N trials per case** (≥3); optionally repeat
   across model tiers (opus/sonnet/haiku) to find the **clarity floor** — the cheapest tier that
   still routes everything correctly (a good router should hold up on haiku for easy cases).

   Write the verdicts to a results file — an array of trial records:
   ```jsonc
   { "id": "<case id>", "tier": "haiku", "primitive": "<routed>", "scope": "user|project" }
   ```

2. **Score deterministically.**
   ```bash
   node evals/score.mjs score --evals evals/routing-evals.json --results <results.json> [--json]
   ```
   Per case it reports `primaryRate` (hit the canonical primitive), `acceptableRate` (canonical or an
   alternative), `scopeMatchRate`, and `mustRejectRate`. A case **passes** iff `primaryRate ≥
   threshold` (default 0.6) **and** no trial ever hit a `mustReject` primitive. Aggregate accuracy is
   reported overall, per-tag, and per-tier (+ the clarity floor).

3. **Iterate without overfitting.** Edit the routing instructions (`../SKILL.md`,
   `../reference/triage.md`) only against a **train** split; select changes by the **test** split:
   ```bash
   node evals/score.mjs split --evals evals/routing-evals.json --ratio 0.6   # stratified, deterministic
   ```
   Drive `primaryRate` up **without** letting `acceptableRate` mask drift, and keep `mustRejectRate`
   at zero. Add new cases (especially `mustReject` near-misses) whenever a real routing mistake is
   found — every routing bug becomes a regression case.

## What good looks like

- Every primitive and every principle has at least one case.
- The confusable twins both route correctly (e.g. the deterministic-pipeline case → `script` AND its
  judgment twin → `skill`) — that pair is what distinguishes a real router from a keyword matcher.
- `mustRejectRate` is zero across the set; the clarity floor trends toward cheaper tiers over time.

> The scorer is itself deterministic and unit-tested — the doctrine applied to our own tooling.

## Latest cross-tier result

Blind protocol, 3 trials/case at each of two tiers (6 trials/case, 126 total verdicts), each subject
handed only the routing brain (`SKILL.md` + `reference/*.md`) and the bare `input` — never the answer
key:

| Tier | Cases passed | Notes |
|---|---|---|
| **haiku** | 20 / 21 | only miss: `deterministic-format-script` (see below) |
| **sonnet** | 21 / 21 | clean |

- **Overall: 100% (21/21), `mustRejectRate` = 0% across all 126 trials.** No forbidden route was ever
  produced, at any tier.
- **Clarity floor: sonnet.** The single sub-floor case, `deterministic-format-script` ("every time
  *I* save a TS file → deterministic prettier/eslint"), is an **inherently dual-valid boundary**:
  `script` (the canonical — determinism gate, and the user's editor save isn't an agent event) and
  `hook` (acceptable if "save" means the agent's own write) are *both* correct, so cheaper tiers
  split between them. Both are scored as passes; neither is a `mustReject`.
- **Scope is advisory, not gated.** `scopeMatchRate` is intentionally low on several cases — `user`
  vs `project` is a **confirm-with-the-user** decision by design (the router recommends, then
  confirms), so blind scope disagreement is expected and does not fail a case (only `primitive`
  gates pass/fail).
- **Instruction fixes this run surfaced:** a *trigger-ownership* note in `triage.md` (a Claude hook
  fires on the agent's own tool events, not the user's editor save) and a clarification that a hook's
  reaction may be **agentic**, not only a script (which had been nudging the agentic-hook case toward
  `agent`). Both are the eval doing its job — every routing wobble becomes a sharpened instruction.
