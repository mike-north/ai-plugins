---
name: domain-planning
description: Discover, develop, or assess a domain plan in ordinary language. Use when clarifying concepts, purposes, responsibility boundaries, relationships, scope, lifecycles, invariants, or consumer questions before or alongside technical specification work. Assess the model itself without assuming a one-to-one mapping to software objects.
---

# Domain planning

Develop a conceptual account that another person can use to explain the domain and decide where responsibilities belong. Producing the plan is design work; filling headings is not the goal.

## Recover the work

Read [the shared workflow](references/workflow.md) and the relevant project artifacts before developing a competing account. On a fresh session, use [artifact and state conventions](references/artifacts-and-state.md) to find the project index, applicable preferences, campaign, and checkpoint. Reconcile them with current files. Read [preferences](references/preferences.md) when placement or work tracking is unresolved; do not require setup before understanding the problem.

The usual journey is product essence → rough domain sketches → developed domain plan → enriched specification → implementation → alignment review. Enter anywhere and return upstream when evidence warrants it. Keep the same developing artifacts and particular references across transitions.

## Discover and challenge meaning

Use [domain reasoning](references/domain-reasoning.md) as a selective toolkit, not a mandatory checklist:

1. Start with concrete people, situations, and the statement a consumer should understand. Separate observations from implications and product choices.
2. Describe concepts without their names, then choose names that expose their distinctions and responsibilities. Vary account, usage, topic, and time to discover what really varies independently.
3. State each important concept's purpose, what belongs within it, and relevant exclusions. Describe meaningful change before inventing state enums or version resources.
4. Ask transport-independent consumer questions. Challenge whether the model answers them without substantial domain deduction left to callers.
5. Compare plausible models and credible counterexamples. A derived concept or projection may be meaningful; table ownership and independent identity are not admission tests.

Use Deep Design when the organizing frame or accumulated concepts need a serious compression pass. It is optional for ordinary planning. Surface a proposed compression's enabling assumption and sacrifice, get the consequential human decision, and preserve its rationale and revision trigger.

## Develop a first-class plan

Develop useful sketch content into the repository's domain plan, preserving proposed versus accepted standing. Do not maintain a rival concept inventory that silently diverges. Use [artifact templates](assets/artifact-templates.md) only where they help; retain the project's vocabulary and structure.

PM-led product shaping and tech-lead-led domain planning inform each other. Both participate in both; early architectural steer is valuable without creating a mandatory sign-off process. Technical representations can expose new questions but must not silently settle conceptual meaning.

Keep conceptual rules, proposed choices, observed current behavior, and accepted future commitments distinguishable. Existing acceptance may be reused with its source. Do not ratify a new choice merely by writing it down.

## Assess and hand off

Assess whether the plan is coherent and useful for its purpose separately from whether software conforms. A clear plan can still be wrong. Purpose and responsibility boundaries matter before an observable defect occurs; concerns need grounded reasoning, not formal proof.

For a difficult model, use [focused specialist assessment](references/specialist-review.md) when delegation is available and authorized. Otherwise run the same questions yourself. Preserve disagreement.

Hand authoring the relevant plan sections, decisions, scenarios, and open questions. Authoring should elaborate them by reference. For an interrupted audit, return the developed material and the unresolved acceptance question to that original job. Save consequential project understanding in reviewable repository artifacts and checkpoint the contributor's live question at meaningful boundaries using the shared conventions.
