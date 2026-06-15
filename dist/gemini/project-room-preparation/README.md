# project-room-preparation

A skill for preparing messy project sources into an inspectable work surface before any drafting begins. Built around the principle: **build the room, then write in it.**

## What it does

When a user has a pile of project files — folders on disk, uploads in a workspace, or both — and needs to draft something high-stakes from them (board memo, strategy doc, investor update, proposal, article), this skill organizes the source set first and only drafts from a reviewed, clean room.

The skill packages four chained prompts:

1. **Project Room Builder** — for file-system tools (Claude Code, Cursor). Walks a folder tree, creates a structured project room on disk, builds a source inventory, duplicate log, conflict log, missing-context list, per-file summaries, and a working brief. Never modifies originals.
2. **Source Inventory & Audit** — for upload-based tools (Claude Projects, ChatGPT Projects, NotebookLM). Same artifacts, in-conversation, no file-system access required.
3. **Grounded Draft from Clean Room** — produces the final deliverable with inline source citations, labeled inferences, and explicit flags for unsupported claims.
4. **Project Room Refresh** — updates an existing room when new files arrive, scope shifts, or the inventory needs re-validation.

## Installation

Already registered in `~/.claude/marketplace/.claude-plugin/marketplace.json`.

## Layout

```
project-room-preparation/
├── .claude-plugin/plugin.json
├── README.md
└── skills/
    └── project-room-preparation/
        ├── SKILL.md
        └── references/
            ├── 01-project-room-builder.md
            ├── 02-source-inventory-audit.md
            ├── 03-grounded-draft.md
            └── 04-project-room-refresh.md
```
