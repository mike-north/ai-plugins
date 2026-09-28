# Discover and apply preferences

Use existing user-level agent guidance and repository instructions as the initial configuration mechanism. Discover the scope through the host's actual configuration facilities; `AGENTS.md` or `CLAUDE.md` by itself does not tell you whether a rule is user-wide or project-local. Do not invent a universal configuration path or parser.

Read only relevant preferences. Current explicit instructions may choose an authorized exception; repository conventions establish shared locations and coordination for this project; personal rules supply defaults where the project is silent. If applicable rules conflict, show the concrete conflict rather than create competing records. Record which source supplied the effective choice in the work index/checkpoint when needed for resumption. A local exception does not change a standing preference.

Collect unresolved choices when relevant, not in an onboarding questionnaire:

- Shared specification/index location, reusing the repository's existing layout.
- Project campaign representation and its authoritative record, such as a Markdown plan or an issue parent with subordinate work items.
- Individual work-record convention, distinct from project campaigns.
- Working-state folder within the checkout area; worktree isolation or explicit sharing; tracking and retention policies.

The user may ask to persist a chosen default in their agent configuration. Honor the requested scope and normal file permissions, without duplicating settings in every skill. Without that request or existing authority, propose the precise preference text for review rather than modifying global settings. A preference for issue-based campaigns is not permission to create issues, message people, publish changes, or operate inaccessible services.

If a preferred service is unavailable or a write is unauthorized, continue independent design work and save an authorized co-located draft/checkpoint, clearly labeled as not synchronized. Keep the existing authoritative record identifiable. Do not silently substitute a new shared system or report an update that did not occur. When access returns, reconcile the draft with the actual record before updating it under the user's authorization.

Storage choices cannot move proposed specifications or review-required substance out of the repository. The issue tracker can hold campaign progress while the governing design and rationale live in checked-in artifacts. Do not maintain independently authoritative issue and Markdown copies of one campaign.

## Example preference text to adapt

These examples are choices, not installed defaults. Fill in actual locations only after discovering or agreeing the convention.

> Use the repository's existing design index for shared specifications. Keep project campaigns in the team's established campaign system, with one authoritative record per campaign. Individual checkpoints live in the checkout's chosen working area, linked from its local active-work index. Reuse my existing global-ignore convention for that area. Keep worktree state separate unless I explicitly choose to share it. Bring all specification and review-required meaning into checked-in project files. Do not change external services or global configuration merely because this preference mentions them.

For a solo contributor, an explicit variation can version working records and retain completed checkpoints. For a team, a project may choose shared Markdown campaigns while individual checkpoints remain local. Scope is based on what a record describes, not how many contributors work on it.
