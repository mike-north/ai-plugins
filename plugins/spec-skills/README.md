# Design and Specification

One connected workflow under the existing `spec-skills` plugin identity: clarify a product's essence, explore rough domain sketches, develop a domain plan, elaborate a specification collection, and carry that intent into implementation and review. Enter at any skill and revisit earlier work when evidence warrants it.

| Entry point | Job |
| --- | --- |
| `deep-design` | Intensive assumption discovery, rival models, and conceptual compression with visible sacrifices and human decisions |
| `domain-planning` | Meanings, purposes, responsibilities, relationships, scopes, change, and consumer questions in an evolving domain plan |
| `spec-authoring` | Contracts, examples, representations, and validation approaches that reference particular plan sections |
| `spec-audit` | Alignment across accepted intent, code, comments, tests, and outputs; clear mismatches, grounded concerns, ambiguities, and coverage |

The existing authoring/audit entry points remain compatible. The plugin does not supply a general implementation agent, mandatory design approval process, or formal proof system.

## Try the local package

From a checkout of this marketplace, Claude Code supports session-only loading:

```sh
claude --plugin-dir ./plugins/spec-skills
```

The installed CLI's `--help` documents this flag; it loads the local package without global installation. Runtime skill/agent activation still depends on the host. No persistent installation or host configuration change is required for a local review.

For a file-capable assistant without plugin loading, ask it to read the relevant `skills/<name>/SKILL.md` in this directory and use its linked resources. Preserve the four sibling skill directories together because they share references. Do not install individual folders without their dependencies.

Example requests:

- “Use Deep Design to help us discover the organizing idea behind these product situations.”
- “Develop this sketch into a domain plan; preserve our open questions and existing decisions.”
- “Specify the adoption operation by reference to the usage and version sections of our plan.”
- “Audit this change against the current release's accepted intent; include responsibility drift.”
- “Resume the campaign from the project's active-work index and reconcile intervening design changes.”

Claude, Cursor, and Codex manifests remain under their existing paths. Use the host's supported local-marketplace mechanism if choosing a persistent installation; this repository does not silently configure it. Exact native agent availability must be verified in the chosen host. Hosts with delegation can use the included specialist briefs even if they do not register the agent definitions natively.

## Continuity without a giant document

The [shared workflow](skills/domain-planning/references/workflow.md) connects the capabilities. The repository specification collection contains the domain plan, detailed contracts, decisions, examples, and review guidance, each in its appropriate role. Contracts refer to particular plan sections rather than duplicate definitions. A no-spec audit routes to authoring, and possibly domain planning, then resumes only against actual accepted intent.

The [artifact/state conventions](skills/domain-planning/references/artifacts-and-state.md) distinguish project knowledge, bounded campaigns, and individual working checkpoints. All specification-shaped and review-needed material belongs in the reviewable repository revision. Personal work can stay in a configurable, discoverable, co-located working folder, usually ignored for team use. Worktree state stays separate unless explicitly shared; symlinks do not grant target access.

[Preferences](skills/domain-planning/references/preferences.md) are readable rules in existing user/project guidance, not a new configuration database. Reuse established conventions and collect only relevant missing choices. No folder name is imposed, global Git configuration is not modified, and service preferences do not authorize external writes. [Small templates](skills/domain-planning/assets/artifact-templates.md) support decisions, contracts, campaigns, and checkpoints without prescribing a mandatory document set.

## Rich assistance and portable review

The rich path supplies two focused read-only agents: `domain-assessor` challenges plan quality; `alignment-tracer` follows a bounded change through accepted intent and evidence. Their [host-neutral briefs](skills/domain-planning/references/specialist-review.md) also work through generic delegation tools, or as sequential lenses when delegation is unavailable. The coordinator preserves disagreement and the original task. No background hooks are added.

The optional [review-input checker](skills/spec-audit/references/review-inputs.md) reports whether explicitly selected documents are regular files in a named committed Git snapshot. It requires Node.js and Git; it does not determine acceptance, sufficiency, or semantics and never reads private state or follows document symlinks.

The self-contained [Markdown review adapter](skills/spec-audit/assets/repository-review.md) is usable in repository review instructions without scripts, subagents, sibling skills, or author context. Adapt it into the existing checked-in review guidance and verify the chosen host loads that guidance. Naming a file is not proof of activation. It can leave an authoring handoff when intent is missing rather than pretend to execute a tool-dependent workflow.

## Authoring and validation

This repository is the source of truth for this unified package. Edit `skills/`, their references/assets, `agents/`, `aipm.config.ts`, and the authored per-host plugin manifests here. Do not mirror edits into installed caches or older personal skill copies. The host manifests are authored inputs in this aipm version; marketplace registries and hook JSON/adapter outputs are generated by `aipm build`.

From the marketplace root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm exec vitest run tests/spec-skills-review-inputs.test.mjs
pnpm exec remark plugins/spec-skills --ext md --frail --quiet
```

The helper's tests use actual disposable Git repositories and were written before its implementation. [Behavioral scenarios](evals/scenarios.md) cover the primary journey, no-spec audit, decompression, fresh-session recovery, campaign preferences, private-versus-reviewable knowledge, and worktree state. See [validation results](evals/results.md) for observed checks and limits. Structural checks do not demonstrate agent reliability.

The reasoning adapts the supplied Deep Design method and domain-planning guidance alongside the existing spec-authoring/spec-audit skills. Compression remains strong but conditional: show its enabling assumption and sacrifice, obtain the consequential decision, and preserve rationale for later reconsideration. Comments express durable intent; they are not evidence that behavior works.
