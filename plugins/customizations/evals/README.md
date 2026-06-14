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
