# Artifact roles, persistence, and recovery

## Classify by subject first

Ask what the information describes: the project, a bounded undertaking of the project, or an individual's work. Lifetime, audience, storage, and Git tracking are separate dimensions. A one-person migration can be a project campaign; a several-agent investigation can be individual work. Sharing personal notes does not ratify them.

| Role | Governing home | What it holds |
| --- | --- | --- |
| Shared knowledge | Repository files, included in the reviewable revision | Product framing, domain plan, proposed and accepted specifications, durable decisions, scenarios, required review guidance/evidence |
| Project campaign | Existing preferred authoritative work-tracking record | Bounded objective, scope, work items, dependencies, progress, links to governing artifacts |
| Individual work | Co-located project working area, usually untracked for team use | Candidate exploration, investigation sequence, checkpoint, pending questions, next action |

Anything specification-shaped belongs in the repository, including proposed specifications. Anything needed to assess a code change must be checked in with the reviewable revision. An ignored local contract, staged-only file, private checkpoint, issue discussion, or bare external link is insufficient. Bring the relevant decision, obligation, rationale, or example into the repository with its standing and provenance. Keep only the needed substance, not the whole conversation.

Rough brainstorming can begin in personal notes. Once a sketch states a proposed project model or contract that others should assess, develop it into the repository collection with its status. Do not hide a nearly complete specification in scratch by calling it a checkpoint.

## One specification collection

Discover and reuse the existing specification home. It can be a folder whose index points to material elsewhere in the same repository. Do not relocate a mature layout or require prescribed filenames. The domain plan remains first-class as contracts become more detailed.

The index is a reading map: what answers each question, what governs which scope, and what remains proposed or superseded. It should link, not re-summarize obligations into another normative source. Product intent owns goals and experience; the domain plan owns meaning and responsibilities; contracts elaborate obligations and representations; decisions own rationale and acceptance history; scenarios and tests provide different evidence.

Reference particular file sections. An illustrative reference is `[usage identity](domain-plan.md#usage-identity)`, followed by what the contract adds, such as authorization preconditions. Use stable identifiers for frequently cited sections where useful. Do not copy definitions across documents. Explain deliberate deviations and get their consequential decision rather than silently overriding the plan. A surviving link can still have stale meaning.

For substantive revisions, inspect affected references, examples, tests, and migration implications. Follow further dependencies where the meaning changes; acknowledge unexamined areas rather than promising exhaustive impact analysis. Preserve superseded rationale so discarded distinctions can be recovered.

## Decisions and campaigns

A consequential decision records the question, choice, rationale, enabling assumptions, accepted sacrifice, alternatives, applicable scope, known acceptance basis, and revision trigger. This may be a paragraph in an existing plan rather than a new ADR. Acceptance and delivery state remain separate. Proposed decisions are useful shared knowledge when labeled clearly.

A campaign spans sessions and perhaps multiple work items, but does not become another source of domain truth. Keep one identifiable authoritative progress record according to the effective preference. An individual's checkpoint references it. If a campaign contains specification or review-required content, that substance also needs its governing home in checked-in artifacts. Promote lasting outcomes before archiving campaign coordination history. Retention follows the chosen convention; do not delete records automatically.

## Working state inside the checkout

Read [preferences](preferences.md) to locate the chosen working area. It must be co-located within the checkout's working area; its name and placement are configurable. `scratch/` is an example, not a universal default. Do not create a central user-level store for every project's state. User-level instructions may describe the convention, not house the state.

Reuse existing exclusion rules. A user's global Git ignore pattern is the preferred exclusion mechanism when that is their convention, but do not silently edit global Git configuration or force a repository-wide ignore policy. If no suitable convention exists, ask a narrow placement/tracking question when persistence is needed. Do not make “untracked” imply disposable or “committed” imply accepted. Explicit solo versioning is legitimate.

Make the area discoverable through applicable local instructions or an index at the configured location. Maintain an active-work index naming work-item/contributor records and their campaign/reference links. A fresh session should not need the previous chat to locate it. Separate records prevent unrelated contributors or agents from overwriting each other's next step.

A compact checkpoint identifies the original job and scope, current checkout/revision, last meaningful result, live candidate and uncertainty, pending human choices, artifact references, edits/checks completed, and next action. Link authoritative content rather than copying it. Replace or consolidate obsolete checkpoints according to preference after promoting important project meaning.

Each Git worktree has its own working state by default. Share only when explicitly chosen, for example by a symlink to another project working area. Do not centralize worktrees silently. Before accessing a linked area, establish its resolved location and applicable permissions using available tools. A symlink supplies no permission to its target; if access is unavailable, report that limitation and preserve only an authorized local draft if useful. Never bypass the boundary with another tool. Shared records still need work-item IDs and checkout/revision context; coordinate writes rather than racing on one file.

## Resume from evidence

1. Read the applicable convention and local work index, then identify the relevant campaign/checkpoint without sweeping unrelated private notes.
2. Read the project index and the particular artifacts cited for the task. Check the actual current revision and edits through available tooling or supplied review context.
3. Reconcile checkpoint assertions against current sources. Newer accepted intent wins over stale notes; missing acceptance stays missing. Surface conflicts without inventing a lost conversation.
4. State the recovered live question and continue the next useful step. Update the checkpoint after meaningful progress, not after every tool call.

If a location or service is inaccessible, say what cannot be recovered. Local persistence alone does not provide cross-machine continuity. A repository-only reviewer must receive all necessary review knowledge in the revision, independent of the author's preferences and checkpoint.
