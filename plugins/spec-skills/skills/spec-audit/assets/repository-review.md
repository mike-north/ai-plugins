# Design and specification review

This is a standalone Markdown instruction for repository-only review. Adapt it into the repository's existing review instructions, recording concrete index/contract locations where known. Merge with existing guidance rather than overwrite it. Check in the adapted instruction and required design material with the change. No plugin, script, subagent, external service, or private author context is required. File naming alone does not activate any host's review integration; configure or verify that separately when authorized.

## Find the governing intent

Read the repository's design/specification index and follow the sections relevant to the change: product intent, domain plan, contracts, decisions, and normative examples. Reuse existing accepted material even if it is not named “spec.” Establish the reviewed revision, source standing, supersession, and applicable delivery scope.

An accepted future plan is not automatically a current-release obligation. A proposed plan is not accepted because it is committed. Code and tests show aspects of current behavior; they do not ratify requirements. When sources conflict, report the conflict instead of selecting one silently.

If no governing specification exists, say so and leave a bounded authoring handoff: the original review question, missing meaning or decision, relevant evidence, candidate alternatives if useful, and what must be accepted before comparison can resume. Domain planning may be needed before detailed authoring. Do not synthesize a description from code and audit against it as if it were accepted intent.

All specification-shaped material and context required to judge the code must be available in the reviewable repository revision. A link to an issue, private checkpoint, user preference, or local-only document cannot substitute for the needed decision or rationale. Report missing review context and the specific substance to capture. If your environment cannot write, report the handoff without claiming to have persisted it.

## Examine meaning and realization

First distinguish whether the plan is coherent for its purpose from whether the implementation conforms. Follow relevant concepts, purposes, responsibility boundaries, relationships, scopes, invariants, scenarios, and consumer questions. Then inspect the actual changed code, tests, outputs, and comments against the applicable intent.

Different software structure can preserve the same model. Do not require one class, table, service, or endpoint per domain concept. Derived concepts and discriminators are not automatically defects. Responsibility drift can matter before an external failure occurs; explain the specific boundary and consequence. Comments express intent but do not prove behavior.

For compression decisions, inspect the enabling assumption, sacrifice, and revision trigger. Evidence that breaks the assumption warrants reconsideration and affected-artifact analysis, not erasure of the earlier decision or automatic rewriting of the spec to bless code.

## Report proportionately

Distinguish:

- Clear mismatch or specified-but-missing behavior: cite accepted applicable intent and conflicting evidence.
- Reasoned concern: cite evidence, the affected purpose/assumption/boundary, the inference, and its consequence. A proved failing scenario is not required; uncertainty must remain visible.
- Ambiguity or contradiction: identify the decision/source conflict that prevents a reliable judgment.
- Unexamined or unavailable area: state the coverage limit; absence of findings is not verified alignment.

Include meaningful validation gaps where relevant. Keep severity, confidence, and coverage separate. Recommend a proportionate next step; changing normative intent requires its real decision, not merely a convenient audit repair. Do not publish, mutate external systems, or ratify proposals through this review instruction.

Summarize the sources and areas actually examined. If everything inspected aligns, say that with the remaining limits. This is focused agent review, not formal proof or a claim of exhaustive assurance.
