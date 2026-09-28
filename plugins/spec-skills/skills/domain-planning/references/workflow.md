# A connected design workflow

Read this at entry to any of the four skills. It defines shared behavior; specialized reasoning lives in the individual skills.

## The primary journey

| Work | Develop or reuse | Carry forward |
| --- | --- | --- |
| Deep Design | Product purpose, concrete situations, load-bearing constraints, rival explanations, rough domain sketches | Product essence, live candidate, assumptions, stress scenarios, explicit compression decisions |
| Domain planning | The promising sketch and those same situations | Meanings, purposes, responsibilities, relationships, scopes, change, invariants, consumer questions |
| Specification authoring | Particular plan sections and accepted decisions | Operation contracts, examples, representations, failure cases, validation approaches, preserved behavior |
| Implementation | The relevant parts of that collection | Tests, implementation, durable code intent, evidence, explicitly surfaced design conflicts |
| Spec audit | Accumulated accepted intent and the actual review revision | Clear mismatches, grounded concerns, ambiguities, unexamined scope, targeted follow-up |

Implementation uses the host's existing engineering capabilities and repository instructions; this plugin is not a second implementation agent. For a bounded implementation handoff, name the task, governing sections, current obligations, non-goals, acceptance basis, validation examples, and unresolved questions. Do not copy the whole specification into a task or turn future concepts into today's requirements.

This is a primary path, not a forced process. A direct contract edit need not start Deep Design. A review can expose a missing plan. Downstream evidence can require reconsidering an accepted assumption. Use the smallest relevant capability and stop an unproductive loop when evidence or a human decision is needed.

## Establish the current job

Identify the question, scope, requested deliverable, and current work item. Reuse discoverable existing artifacts and acceptance rather than asking the user to repeat them. On a fresh session, read the project index, effective convention, relevant campaign/checkpoint, and actual referenced files; reconcile changes before continuing. [Artifact and state conventions](artifacts-and-state.md) specify where each kind of information belongs.

The user's scope and authorization persist across capability transitions. Switching skills does not require another permission request. A storage preference does not authorize external messages, publication, or configuration changes. Ask only missing consequential choices, completing independent work meanwhile.

## Preserve authority

Keep observation, inference, proposal, and accepted decision distinct. Acceptance needs a known basis: an explicit user decision or an existing authoritative project source applicable to this scope. Record that basis and what was accepted. A timestamp, commit, passing test, fluent prose, or checkpoint assertion does not confer authority. Acceptance of one choice does not ratify neighboring proposals.

Keep acceptance and delivery scope separate. An accepted future plan is not necessarily a current-release obligation. When sources disagree, show the conflict and affected judgment; do not average them or silently pick code as truth. Never edit intent merely to make the implementation pass review.

During human collaboration, consequential compression needs the enabling assumption, what is given up, relevant counterexamples, and a human decision. Preserve accepted rationale and the condition for revisiting it. Human acceptance of an uncertain assumption does not make it an observed fact. Decompression restores a distinction and revises dependents; it may require costly migrations.

## Missing dependency and resumption

Existing requirements, accepted examples, decisions, or design prose may establish intent without a file called “spec.” Nevertheless, if no governing specification exists, spec audit must say so and route to spec authoring. Authoring may require domain planning; domain planning may benefit from Deep Design. Do not evade this tripwire by auditing a code-derived description as if it were accepted intent.

Persist a bounded handoff containing:

- The original question, target, scope, and requested result.
- Relevant sources, their standing and revision, and what remains unresolved.
- The smallest dependency needed, work produced, and decision still needed.
- The concrete condition for resuming the original job.

Use the current checkpoint for personal handoff state; project decisions and reusable findings belong in the repository. If authoring produces a candidate, it remains a candidate until accepted. Resume comparison against actual accepted intent, distinguishing newly accepted targets from rules that already governed the code. If the user does not decide, finish independent review and report the dependent judgment as unresolved.

Rich assistants can invoke a sibling skill or delegate the bounded dependency. If that facility is unavailable, read the sibling guidance and perform the step directly. A read-only Markdown reviewer can record the dependency and resumption condition without pretending to author or invoke anything.

## Persist meaning as work happens

After substantive model changes or decisions, before handing off or switching focus, and at a pause, save the relevant meaning. Shared artifacts carry project understanding; checkpoints carry unfinished individual work. Do not wait for a transcript summary or checkpoint every utterance. If interrupted before saving, disclose missing context rather than fabricating recovery. Session persistence does not guarantee transfer across machines or access to other worktrees.
