---
name: customizations
description: Create, list, or remove an agent customization — routed determinism-first to the right primitive
arguments:
  - name: subcommand
    description: "One of: create (default), list, remove"
    required: false
  - name: type-or-slug
    description: "For create: an optional primitive type (script, memory, rule, hook, skill, agent, mcp, monitor, plugin, marketplace). For remove: the customization slug."
    required: false
---

Invoke the `customizations` skill and run its routing flow, using the arguments below.

Arguments: `$ARGUMENTS`

Dispatch:

- **`create`** (or no subcommand) — run the full routing flow from the skill: apply the
  **determinism-first** gate, split detection from response for any sense/react need, pick the
  right primitive and scope, then author the light primitives directly or delegate the heavy ones
  (installing the delegate on demand with the user's confirmation). Read the relevant
  `reference/authoring/<type>.md` fresh before authoring. Record the result in the manifest.
  - If a primitive **type** was given (e.g. `create plugin`), skip triage and author that type —
    still recommend a scope and still apply the determinism discipline. For `plugin` with no known
    personal marketplace, route to `marketplace` first.

- **`list`** — run the skill's manifest helper (`skills/customizations/scripts/manifest.mjs list`)
  and present the tracked customizations (including any `proposed` ones) plus plugins in the known
  personal marketplace, with type, scope, and status.

- **`remove <slug>`** — run the skill's manifest helper
  (`skills/customizations/scripts/manifest.mjs remove <slug>`; it prints the entry's components),
  confirm with the user, then delete those artifacts. For a `plugin`, unregister via `aipm`.

Follow `skills/customizations/SKILL.md` for the authoritative behavior; this command is only the
entry point.
