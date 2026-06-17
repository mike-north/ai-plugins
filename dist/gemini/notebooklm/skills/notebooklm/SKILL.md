---
name: notebooklm
description: Use when the user wants to turn source material — repo files, docs, or links — into a NotebookLM audio podcast ("Audio Overview") they can listen to on a walk or commute. Covers choosing the podcast format (deep-dive, brief, critique, debate), setting length, and crafting the host-focus prompt so the podcast concentrates on the aspects of the source that matter most. You decide which sources to use and how to focus the hosts; the aichatctl CLI creates the notebook and kicks off generation. Triggers on "make me a podcast", "turn this into an audio overview", "I want to listen to this", or wanting NotebookLM to summarize sources as audio.
---

# NotebookLM podcast

Turn files and links into a NotebookLM **Audio Overview** — an LLM-generated podcast
with two hosts discussing the material — that the user listens to on mobile. You
compose the host-focus prompt and pick the format; the `aichatctl` CLI creates the
notebook, adds the sources, and starts generation.

## The contract

You reason; the CLI executes. **Never drive the browser yourself.** See
`references/aichatctl-cli.md` for the transport model, the `doctor` preflight, and the
`--json` rule. Everything below assumes you call the CLI and parse its JSON.

## Prerequisite

NotebookLM is supported **only via the AppleScript transport** (macOS, plus the one
Chrome "Allow JavaScript from Apple Events" toggle). Preflight once per session:

```bash
npx aichatctl doctor --transport applescript --json
```

If NotebookLM/Google isn't ready, tell the user how to fix it before proceeding.

## Step 1 — Choose the format

NotebookLM offers four Audio Overview formats. Pick the one that fits the user's goal:

- **`deep-dive`** (default) — two hosts explore the material in depth, explaining and
  connecting ideas. The everyday choice for "help me understand this."
- **`brief`** — a short, high-level overview. Use when the user wants the gist fast.
- **`critique`** — an evaluative take that weighs strengths and weaknesses. Use for
  reviewing a proposal, design, or draft.
- **`debate`** — two hosts argue opposing positions. Use to stress-test an idea or
  surface the tensions in a decision.

## Step 2 — Choose the length

`--length short | default | long`. Note: NotebookLM applies length only to **some**
formats and silently ignores it for others, so treat it as a hint, not a guarantee.
Default to `default` unless the user asks for something quick (`short`) or thorough
(`long`).

## Step 3 — Curate the sources

Each `--source <file-or-dir>` becomes a text source (directories expand to their
files); each `--source-url <url>` becomes its **own** source (so a Google Doc link
lands as that document); `--source-text -` reads one source from stdin.

- Prefer **prose**: specs, design docs, READMEs, notes. The hosts read these well.
- **Avoid dumping code-heavy files.** A podcast can't read code aloud usefully (see
  `references/spoken-medium-principles.md`). If code matters, point the hosts at the
  *prose that explains it* and let the focus prompt describe the behavior.

## Step 4 — Craft the host-focus prompt

`--prompt "<what the hosts should focus on>"` (or `--prompt-file <path>`, `-` for
stdin) is your main steering lever. It tells the two hosts which aspects of the
sources to concentrate on and from what angle. This is where most of the value is —
without it you get a generic summary; with it you get a podcast aimed at exactly what
the user needs.

Make the prompt **audio-first** (`references/spoken-medium-principles.md`):

- Name the **audience and goal**: "Explain the migration plan to a new engineer who
  has never seen this codebase."
- Name the **angle/aspects** to emphasize and what to skip: "Focus on the trade-offs
  behind the retry strategy; don't walk through the configuration options."
- Steer toward **concepts, narrative, and decisions** — not reading code, URLs,
  dates, or identifiers aloud.
- Keep it to a few sentences. The prompt frames the conversation; it is not a script.

Good: `"Give a new engineer the mental model for how auth works here — the why behind
the token-rotation design and the one risk we're still worried about. Keep it
conceptual; no code walkthroughs."`

## Step 5 — Kick off generation

```bash
npx aichatctl notebook create \
  --source <file-or-dir>... --source-url <url>... \
  --format <format> --length <length> \
  --prompt "<host focus>" \
  --transport applescript --json
```

The command returns once generation is **kicked off**; the audio renders in the
background (minutes). The JSON result includes the notebook `url`. Give that URL to
the user — they open it on mobile and listen once it's ready.

## Step 6 — Readiness

`aichatctl` currently has **no way to check whether the podcast has finished
rendering** — `notebook create` returns at kickoff and there is no status/poll
command. So:

- Tell the user the podcast is generating and to open the `url` in a few minutes.
- Do **not** claim it is ready or block waiting on it.

This gap is tracked as a feature request on aichatctl (see the plugin README). When a
`notebook status` capability lands, this skill should poll it and tell the user when
the audio is actually ready.

## References

- `references/aichatctl-cli.md` — transports, `doctor`, the reason-vs-execute contract.
- `references/spoken-medium-principles.md` — writing for the ear (shapes the focus
  prompt and source curation).
