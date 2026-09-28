# Reasoning about domain meaning

Select questions that expose uncertainty in the current problem. These are reusable tactics, not a mandatory DDD methodology or a recipe that proves a model sound.

## Purpose before representation

Write the statement the consumer should understand, then investigate the concepts that explain it. Distinguish observed facts, inferred judgments, and proposed recommendations. A clear statement can still be false. For example, “a newer version exists,” “this usage can adopt it,” and “you should upgrade” make different claims.

For each important concept, explain what it represents, why the distinction matters, what responsibility belongs, what is excluded, and which invariants protect that purpose. Names should help another engineer place a new responsibility. An evaluator whose purpose is predictable in-process decision evaluation should not absorb arbitrary effects simply because the UI composes evaluation and actions.

This can reveal drift before an externally visible failure. Cite evidence and explain the concern; do not demand a failing test as admission. Conversely, a different software decomposition can preserve the same meaning. Concepts need not correspond one-to-one to classes, tables, services, or endpoints.

## Scope, relationships, identity, and change

Describe related concepts without names before deciding whether they differ. Shared storage shape is weak evidence of shared meaning. Definition/record and workflow/run may have similar cardinality while conveying different responsibilities.

Vary one dimension at a time: account, usage, topic, actor, version, or time. Ask what can legitimately vary independently and whose fact a field expresses. Usage-specific facts can also be account-specific, so test the narrower scope first. Candidate scopes do not automatically justify new objects.

Follow several actors through a task to discover identity needs. A shared identifier is not an authorization grant or necessarily a sufficient cache key. Describe before/occurrence/after and who cares before selecting lifecycle states. “Only an author changes it” does not establish immutability. A meaningful domain event does not mandate a broker or event sourcing.

## Consumer questions and representations

A query catalog records transport-independent questions, what the caller knows, the desired answer, a proposed answer path, and remaining interpretation. Every question does not require one call. The model should make important domain judgments explainable instead of requiring callers to reverse-engineer them from unrelated rules.

Compare a proposed projection with the underlying resource plus relationship state on the same consumer task. Count identity translation, duplicated meaning, extra reads, and consistency costs on both sides. A derived concept, such as upgrade eligibility, can be meaningful. A projection can also express a domain concept; independent identity and table ownership are not prerequisites.

Remove the concept, not merely its name: what can no longer be explained? If the distinction returns in prose or configuration, compression may only have hidden it. Discriminators are evidence to investigate, not automatic design failures. Some sum types correctly preserve a useful distinction.

## Challenge with realistic breadth

Use existing customer situations and credible expected growth. Try multiple accounts, independent changes, partial evidence, and temporal transitions where relevant. Preserve field groups whose members must be present together; distinguish missing evidence from a negative conclusion. A warning, a failed check, a blocked action, and unexamined scope answer different questions.

Trace consumer question → discovered distinction → candidate representation → consumer benefit → validation approach. Synthetic examples check example consistency, not business truth or implemented behavior. Several agents agreeing on a plan demonstrates neither correctness nor performance.

## Plan assessment versus conformance

For plan quality, ask whether purposes, relationships, responsibilities, and scenarios form a coherent and useful account. Expose missing decisions and competing interpretations. For implementation alignment, first establish accepted applicable intent, then inspect where responsibilities and behavior are realized. Comments express intent and may expose a conflict; they do not demonstrate behavior. Preserve clear mismatches, reasoned concerns, ambiguities, and unexamined areas without collapsing them into a pass/fail claim.
