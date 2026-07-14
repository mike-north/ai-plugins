---
name: project-room-preparation
description: This skill should be used when the user is about to draft a high-stakes deliverable (board memo, strategy doc, investor update, proposal, article, brief) from a messy or unorganized set of project sources, or asks to "organize my project files", "build a source inventory", "prepare these sources", "before I write the memo", "I have a bunch of files", "audit these uploads", "refresh the project room", or otherwise wants source preparation before any writing happens. Activate when the user mentions a project room, source inventory, working brief, conflict log, or missing-context list, or when they uploaded documents into a Project workspace (Claude Projects, ChatGPT Projects, NotebookLM) and want help making sense of them before drafting.
---

# Project Room Preparation

## Purpose

Turn a messy folder of project sources into an inspectable work surface — source inventory, duplicate log, conflict log, missing-context list, working brief — **before** any drafting begins. The skill is built on one principle: **build the room, then write in it.** The single most important output is the source inventory; drafting from un-reviewed sources is the failure mode this skill exists to prevent.

This skill packages four orchestrated prompts that chain in sequence but also work independently. Pick the right one based on the user's current tool and where the sources live.

## Decision Table: Which Prompt to Use

| Situation | Prompt | File |
|---|---|---|
| Sources live in a local folder tree; the current tool has file-system access (Claude Code, Cursor) | **Prompt 1 — Project Room Builder** | `references/01-project-room-builder.md` |
| Sources are documents uploaded into a bounded workspace (Claude Projects, ChatGPT Projects, NotebookLM) | **Prompt 2 — Source Inventory & Audit** | `references/02-source-inventory-audit.md` |
| Inventory has already been built **and reviewed by the human** — now draft the deliverable | **Prompt 3 — Grounded Draft from Clean Room** | `references/03-grounded-draft.md` |
| A project room already exists; new files arrived or scope shifted | **Prompt 4 — Project Room Refresh** | `references/04-project-room-refresh.md` |

If the situation is ambiguous (e.g., sources on disk *and* uploaded to a workspace), prefer Prompt 1 — it produces durable artifacts on disk that survive across conversations.

## The Recommended Sequence

1. Run **Prompt 1** or **Prompt 2** to build the project room and source inventory.
2. **Pause for human review.** This is the load-bearing checkpoint. Spot-check what was marked authoritative vs. superseded; correct relevance ratings; resolve any flagged conflicts.
3. Run **Prompt 3** to draft the final deliverable from the reviewed room.
4. Run **Prompt 4** whenever new files arrive or the project shifts, then loop back to step 2.

**Never jump from step 1 directly to step 3.** The whole point of the skill is that the room is reviewed before anything is written from it.

## How to Use This Skill

### Step 1 — Identify the situation

Confirm three things before picking a prompt:

1. **Where do the sources live?** Local folder tree, uploaded workspace, both, or unknown.
2. **What is the final deliverable?** Board memo, strategy doc, investor update, proposal, article, brief, or other. The deliverable type shapes relevance ratings.
3. **Is this a first pass or a refresh?** First pass uses Prompt 1 or 2. Refresh uses Prompt 4.

If the user has not yet stated the deliverable, ask before launching any prompt — the inventory's relevance and authority ratings depend on it.

### Step 2 — Load and run the right reference file

Open the relevant file from `references/` and run the prompt inside the `\`\`\`prompt … \`\`\`` block as written. The prompts are designed to be used verbatim — do not paraphrase or shorten them. Each prompt is self-contained and includes:

- A `<role>` block establishing posture (methodical, conservative, surfaces uncertainty)
- An `<instructions>` block with numbered intake questions followed by phased work
- An `<output>` block describing required deliverables
- A `<guardrails>` block enumerating hard rules

When acting as the agent running the prompt, follow it literally — including the intake questions, the phased pacing, and the hard stop before drafting.

### Step 3 — Surface the working brief and stop

After running Prompt 1 or 2, present the inventory, duplicate log, conflict log, missing-context list, and working brief to the user. End with the prompt's exact ask: tell the user the room is ready for review and that drafting will not happen until they say the room is clean. Do not proactively continue to Prompt 3.

### Step 4 — Draft only from a reviewed room

Run Prompt 3 only after the user confirms the inventory and working brief are correct (or after they have edited them). Prompt 3 requires the working brief to be in the conversation; if it is not, ask the user to paste it before drafting.

### Step 5 — Maintain the room as the project evolves

When new files arrive, the user signals scope changes, or enough time has passed that the inventory may be stale, run Prompt 4. Prompt 4 produces a change log and updated artifacts with explicit `[NEW]` / `[UPDATED]` / `[REMOVED]` markers — never silently overwrite prior judgments.

## Hard Rules Across All Prompts

These rules apply to every prompt in the skill. Reinforce them when the user pushes to skip steps:

- **Never modify originals.** Prompt 1 copies, never moves or renames source files. Other prompts work in conversation.
- **Never silently resolve conflicts.** Surface both sides with citations and ask the human to decide.
- **Never blend or average numbers** across versions of the same source. Pick the authoritative version (or flag uncertainty) — never compute a midpoint.
- **Never invent facts.** If a number, name, date, or decision is not in the sources, it does not appear in any output without an explicit unsupported-claim flag.
- **Never skip the review checkpoint.** No drafting before the inventory has been reviewed.
- **Respect sensitive-file flags.** When the user marks a file confidential, reference its existence and structure only — do not quote or summarize contents into shared outputs.

## What "the room is clean" means

The room is ready for Prompt 3 when:

- Every source has a relevance rating the human accepts.
- Duplicate / version families have a designated current version.
- Conflicts are either resolved or explicitly labeled as "draft must surface this conflict."
- Missing-context items are either filled, accepted as gaps to call out, or explicitly deferred.
- The working brief's source hierarchy matches the human's understanding of authority.

If any of these are missing, the room is not clean — stay in preparation mode and ask what to correct.

## Common Pitfalls to Avoid

- **Drafting before review.** The most common failure. If the user says "just write it," remind them what this skill is for and ask them to spend two minutes scanning the inventory first.
- **Treating the deck as authoritative over the transcript.** Decks are summaries; transcripts and raw data are usually the source of truth. Default to the latter unless the user overrides.
- **Letting filename conventions decide currency.** `final_v2` may not be the current version. Use modified date, content recency, and cross-references — and when uncertain, mark it unknown.
- **Silently dropping low-relevance sources.** Keep them in the inventory with `low` or `background` ratings; never delete a row.
- **Skipping Prompt 4 after new files arrive.** Drafting from a stale brief is the same failure mode as drafting from un-reviewed sources.

## Reference Files

The four prompts live in `references/`:

- **`references/01-project-room-builder.md`** — Prompt 1, file-system tools (creates on-disk project room)
- **`references/02-source-inventory-audit.md`** — Prompt 2, upload-based tools (in-conversation artifacts)
- **`references/03-grounded-draft.md`** — Prompt 3, drafting from a reviewed room (with source citations, inference labels, and unsupported-claim flags)
- **`references/04-project-room-refresh.md`** — Prompt 4, maintenance pass when files or scope change

Each reference file starts with a short framing header (when to use it, what it produces, what it asks first, the hard stop) followed by the prompt verbatim in a fenced block. Run the prompt as written — do not paraphrase it.
