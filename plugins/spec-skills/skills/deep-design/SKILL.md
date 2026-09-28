---
name: deep-design
description: Explore a complex product or design by challenging assumptions and finding a smaller explanatory model. Use when discovering a product's essence, comparing rough domain models, or resolving persistent disagreement about what the design is. Avoid this intensive mode for settled implementation, routine edits, or direct factual questions.
---

# Deep Design

Find the smallest set of assumptions that explains the important situations. Compression is the core technique: after decomposition, ask what can collapse back together without losing meaning. This is an intensive thinking partnership, not a demand to minimize concept count at any cost.

Read [the shared workflow](../domain-planning/references/workflow.md) at entry. Recover existing project artifacts and the live checkpoint through [artifact and state conventions](../domain-planning/references/artifacts-and-state.md). Continue the same inquiry instead of restarting it in each session.

## Discover the product's essence

Begin with what people are trying to accomplish and the constraints that genuinely matter. Challenge accidental assumptions before naming objects or designing APIs. Put a concrete candidate organizing idea on the table, state its uncertainty, and test what it explains and excludes.

Guide an intensive exploration through purpose → constraints → accidental assumptions → fundamental and derived concepts → scenarios → collapse candidates → primitives and composition → interfaces. Explain changes of focus when helpful. This is the mode's reasoning order, not a mandatory lifecycle for all plugin work. Answer a direct downstream question briefly, identify unresolved upstream meaning, and return only when useful.

Product essence can lead into rough domain sketches before a developed plan exists. Keep tentative concepts and relationships easy to challenge. A meaningful product choice can revise the sketch; a discovered domain distinction can revise the product experience.

## Behave as a design partner

- Separate observations from their implications. Do not quietly turn an accidental implementation property into a constraint.
- Propose concretely and hold loosely. Replace your own attractive model when a better explanation appears. Disagree with the user's frame when a concrete scenario shows a cost.
- Run an unprompted collapse pass when the model accumulates several concepts. Report promising candidates and why rejected collapses fail.
- Ask which assumption creates complexity before adding another feature. Explain what capability emerges if that assumption can be removed; do not pretend every real requirement is removable.
- Stress-test changes against realistic adjacent situations, including ones that did not produce the model. Revisit the relevant stress list after changes.
- Take names seriously. Explain how a rename changes the reasoning. Distinguish reality, chosen architecture, recommendation, and implementation when those layers are being conflated.

Use [domain reasoning](../domain-planning/references/domain-reasoning.md) for responsibilities, scope, identity, meaningful change, and consumer questions. Do not import DDD objects merely because a methodology supplies them.

## Make compression reviewable and reversible in reasoning

For a consequential collapse, show the old and proposed models, the enabling assumption, the distinction or flexibility given up, tested counterexamples, and the scope where it is intended to hold. Ask for the human's verification and acceptance when it is not already established. Exploring a candidate does not require permission; treating it as accepted does.

Record the decision's rationale, acceptance basis, alternatives, and revision trigger in the shared project artifact. Keep uncertain assumptions uncertain even after a bounded choice. Accepting a compression does not settle unrelated open questions.

Derived concepts are not waste by definition. A discriminator, repeated consumer branching, an awkward “or” name, or distinctions pushed into configuration should trigger investigation—not an automatic veto. Judge whether the candidate explains more with less while preserving purposes and consumer needs.

When a trigger later breaks the assumption, recover the discarded distinction, propose decompression, and trace affected plan sections, contracts, examples, tests, and migration needs. Supersede accepted intent deliberately; do not erase history or promise that shipped representations are cheap to unwind.

## Keep a compact account and hand it forward

Maintain an assumption ledger with basis/uncertainty, a concept inventory with fundamental or derived relationships where useful, a stress list, and a short record of rejected models and what defeated them. They can be sections of existing artifacts, not four new documents or a duplicate model database.

Capture personal brainstorming/checkpoints in the configured co-located working area. Proposed project models, accepted decisions, and all specification-shaped or review-needed content belong in the repository collection. Persist meaningful changes before switching focus or pausing.

Exit when the model explains the important scenarios, further compression offers little value, or the next step needs a decision or evidence. Deliberate product constraints may remain. Summarize the organizing idea, primitives, assumptions removed and retained, sacrifices, scenarios, rejected alternatives, and unresolved choices. Develop the promising sketch through domain planning, then elaborate that same plan through spec authoring. Do not manufacture APIs just to complete the phase list.
