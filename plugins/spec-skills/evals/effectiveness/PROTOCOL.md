# Effectiveness evaluation protocol

## Claims and failure modes fixed before execution

The intervention is frozen skill guidance. We ask whether it improves accepted-intent preservation, conceptual reasoning, recoverable handoffs, and useful review over a capable assistant with no task guidance and over the prior independent skills. A polished answer, matching headers, extra artifacts, or invocation alone does not establish improvement.

Primary risks are unauthorized ratification; loss of pending decisions across sessions; conflating representation with meaning; misreading future plans as current obligations; review context absent from the reviewable revision; false alarms and missed responsibility drift; silent duplicate work tracking; and irrelevant intensive design detours. Compression quality requires a concrete enabling assumption, worthwhile explanatory gain, and understood sacrifice—not fewer nouns.

Before each experiment, freeze inputs, skill files and their SHA-256 hashes. Each case/variant/repeat gets fresh state. Stages intentionally share only files produced by earlier stages, plus scripted user choices or contributor changes; no prior transcript is supplied. Compare the same prompts, fixture, host, capabilities and default model selection. Repetitions sample variation, not population reliability. Reserve holdouts for later versions.

## Distinct measurements

- Behavior: evidence-citing semantic outcomes and dimension scores (authority, reasoning, traceability, continuity, scope, review, capability).
- Routing: separate description-selection proxy, explicit/implicit/contextual/negative prompts. This is not automatic host activation. Native activation requires a separately isolated host and observed reads/invocations.
- Mechanical: actual file creation/preservation, bounded writes, tool use under declared constraints, process completion, trace availability. These are observables, never semantic success substitutes.
- Effort: measured elapsed time, reported token usage, command count, output size. Unknown metrics remain null. No price or token estimate from character counts.
- Review: evidence-backed true findings, missed seeded issues, false positives, unjustified certainty, and coverage limitations.

Scores use 0 (materially wrong/absent), 1 (partial with consequential gap), 2 (adequate), 3 (strong). A severe authority violation is reported separately and cannot be averaged away. Graders must cite output or artifact locations and criticize non-discriminating criteria. Multiple reasonable designs are permitted. Do not reward verbosity, one class/table per concept, or mandatory workflow stages.

## Execution boundary

Each fixture has an unborn disposable Git repository to prevent discovery of a parent repository; no commits are created, and this does not simulate actual inclusion in a committed review revision. Supplied review manifests are fixture evidence only. Repository subjects may read and edit only their isolated fixture and supplied frozen guidance. No network, connectors, publication, global configuration changes, installation, or unrelated files. Markdown-only subjects receive repository contents inline and must make zero tool calls; responses are retained as review artifacts. The driver uses read-only sandboxing for these cases and verifies actual traces; this is instruction-level tool restriction, not a claim that the host removed every tool.

The installed Codex CLI is used through documented `exec --json --ephemeral --ignore-user-config --skip-git-repo-check --sandbox --cd --output-last-message` options. It may still inherit system instructions, skill catalogs and MCP registration. Therefore this controlled guidance comparison has residual contamination: it is not a clean native skill-loading experiment. No-skill means no supplied task guidance. Subjects are explicitly told to use only supplied guidance. Any observed extra loading invalidates that run for the paired claim.

Auth or initialization failures are BLOCKED, never semantic failures or passes. Cases with no completed stage are UNRUN/BLOCKED, partial chains remain PARTIAL. The full corpus is not assumed executed merely because it validates. Runtime probes are not behavior cases.

## Grading and review

Grade separately from subjects, with task inputs, hidden outcomes, raw events and generated files. A shuffled A/B package hides variant labels for pairwise judging; prose may still reveal methods, so blinding is imperfect. Record tie or inconclusive when supported. Human usefulness judgments remain pending until supplied. Model graders are fallible; retain citations and reconcile disputed judgments against artifacts.

The review surfaces are a generated Markdown report with direct paths to responses, metadata, traces, checks and grader packages, plus an export compatible with the upstream Anthropic static viewer. Both require no local server or external service. The viewer presents real per-stage artifacts; the report preserves multidimensional judgments instead of collapsing them into a pass rate.

## Source methods

[OpenAI's evaluation guide](https://developers.openai.com/blog/eval-skills) informed the separation of routing, deterministic traces, rubric grading and repeatable execution. [Anthropic's skill creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md), including its grader and comparator guidance, informed matched baselines, artifacts, repetitions, evidence and blinded comparisons. The local skill-creator guidance adds outcome-focused validation and warns against exact wording assertions. The governing proposal supplies product-specific outcomes; method articles are not themselves product requirements.
