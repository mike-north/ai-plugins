---
name: liaison
description: Use when an agent should arrange a live, two-way VOICE conversation between the user (or another human — a customer, stakeholder, contributor, or teammate) and a briefed AI session, then bring the results back into its own workstream. Best when the agent is blocked on a design decision or significant ambiguity that is faster to talk through than to type, or when it needs to gather feedback or do discovery from a human. The agent acts as a liaison: it syncs the relevant docs into a project so the remote session is briefed, frames the conversation for spoken interaction, seeds a chat the human continues by voice on mobile, and relays a structured findings markdown back to resume work. Triggers on "let's talk this through", "I need to ask the user", "set up a voice conversation", "get feedback from the customer/stakeholder", or hitting blocking decisions that need a human.
---

# Liaison

Arrange a live voice conversation with a human and carry structured findings back into
your workstream. You act as a **liaison**: brief a remote AI session on the topic, hand
the human a ready-to-continue voice chat, and relay what was decided or learned back to
where the work is happening.

Use this when talking is better than typing: a blocking design decision, a genuine
ambiguity, or gathering feedback/discovery from a customer, stakeholder, or
contributor. It is **not** decision-only — any high-bandwidth human conversation whose
result feeds back into the work is a fit.

## The contract

You reason; the `aichatctl` CLI executes. **Never drive the browser yourself.** See
`references/aichatctl-cli.md` for transports, the `doctor` preflight, and the `--json`
rule.

## Prerequisite

Preflight the target platform:

```bash
npx aichatctl doctor --transport applescript --json
```

Claude and ChatGPT support a project file library to sync into; **Gemini is seed-only**
(no project library — skip the sync step and brief entirely in the seed prompt).

## Step 1 — Brief the project (sync the docs)

So the human talks to an *already-briefed* session, make sure the docs the conversation
depends on are present and current in the target project. `aichatctl sync` mirrors a
declared set of repo files (and optional instructions) into the project, driven by
`aichatctl.config.yaml` (`platforms.<platform>.{project, instructions, files[]}`).
**Always dry-run first**, show the plan, then apply:

```bash
npx aichatctl sync --transport applescript --dry-run --json   # preview the plan
npx aichatctl sync --transport applescript --json             # apply it
```

If a doc the conversation needs isn't in the manifest's `files` globs, add it to
`aichatctl.config.yaml` (or tell the user it's missing). Sync only deletes files it
previously synced — anything the user added by hand is left alone.

## Step 2 — Choose the conversation mode

Different conversations must be run differently: a decision walk-through converges to a
choice, a brainstorm diverges, a status readout lets the human drive. Read
`references/conversation-modes.md` and judge which mode fits, using two questions: **who
drives** (you, through the liaison, or the human), and are you **converging or
diverging**.

That file also tells you, per mode, the **situational brief** you must supply and the
**return artifact** you'll get back. You read it to *choose the mode* and to know *what to
brief* — not to learn how the liaison should behave. That conduct is handled for you in
Step 3.

## Step 3 — Assemble the seed prompt

The seed prompt has two parts: a **conduct preamble** that tells the liaison how to run
this mode of conversation, and your **situational brief** — the content only you have (the
actual decisions, design, status, or questions). The per-mode preambles live in
`resources/preambles/<mode>.md` and are written for the **liaison**, not for you.

1. Write your situational brief to a file (e.g. `scratch/liaison-<topic>-brief.md`),
   supplying what `references/conversation-modes.md` lists for the chosen mode. Apply
   `references/spoken-medium-principles.md` so it's written for the ear.
2. Build the seed by putting the preamble first, then your brief:

   ```bash
   cat "${CLAUDE_PLUGIN_ROOT}/skills/liaison/resources/preambles/<mode>.md" \
       scratch/liaison-<topic>-brief.md > scratch/liaison-<topic>-seed.md
   ```

You do **not** need to read the preamble — it instructs the liaison, not you, and it
already covers how to open, how to behave, and how to end (the structured findings
markdown). Read it only if you want to know exactly what the liaison will be told. Your
brief just supplies the situation.

**On Gemini, add the voice-style overlay.** Gemini is tuned by default to be direct and
answer-focused — it marches toward precise answers and resists open-ended, exploratory
talk (worst for brainstorming) — so it needs explicit steering to be a good live voice
partner. When `--platform gemini`, prepend `resources/platform/gemini.md` ahead of the
mode preamble. ChatGPT and Claude voice modes already behave this way, so skip it there.

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/liaison/resources/platform/gemini.md" \
    "${CLAUDE_PLUGIN_ROOT}/skills/liaison/resources/preambles/<mode>.md" \
    scratch/liaison-<topic>-brief.md > scratch/liaison-<topic>-seed.md
```

## Step 4 — Seed the session

```bash
npx aichatctl session create --transport applescript \
  --platform <claude|chatgpt|gemini> --project <name|url|id> \
  --seed-file scratch/liaison-<topic>-seed.md --json
```

The JSON result includes the conversation `url`. Give it to the user — they open the
platform's mobile app and continue **by voice**. (`--no-send` stages the prompt without
submitting, if you want the user to start it themselves.) For Gemini, `--project` is a
Gem URL/id, or `new` for a plain chat.

## Step 5 — Close the loop (arrange the return)

The findings markdown has to get back to you. `aichatctl` is **seed/sync only** — it
cannot read a conversation back (tracked as a feature request; see the plugin README).
So **you, the orchestrating agent, arrange the return mechanism** rather than assuming
one:

- If the user has a standing preference ("always drop these in Notion", "save to
  `scratch/`"), honor it — that wins.
- Otherwise pick a channel both ends can reach and tell the user plainly: have the
  remote agent post the findings markdown to a shared place (a Notion page, a Drive
  file, a synced path), or simply paste it back into this session.
- Define the **artifact**, not the transport: whatever the path, what comes back must
  match `references/return-contract.md`.

When the findings arrive, read them, record the decisions/answers, and resume the
workstream from where it was blocked. Carry any "open" items forward as follow-ups.

## References

- `references/conversation-modes.md` — choose the mode; what to brief; what comes back.
- `references/aichatctl-cli.md` — transports, `doctor`, the reason-vs-execute contract.
- `references/spoken-medium-principles.md` — writing/speaking for the ear.
- `references/return-contract.md` — the base shape of the findings that come back.
- `resources/preambles/<mode>.md` — per-mode conduct for the **liaison** (attach to the
  seed; you needn't read them).
- `resources/platform/gemini.md` — voice-style overlay to prepend on Gemini (which is
  answer-focused by default); skip for ChatGPT/Claude.
