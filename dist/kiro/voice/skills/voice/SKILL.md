---
name: voice
description: Use when the agent should deliberately SAY something aloud to the user through the computer's speakers — a short spoken status, a nudge for attention when the user may be away from the screen, or a brief spoken summary. This is for intentional, specific utterances, NOT a verbatim reading of the chat transcript. Uses the macOS `say` command today, with a clean path to swap in vocli for real cross-platform text-to-speech later. Triggers on "say that out loud", "tell me out loud when it's done", "read me X", "announce when the build finishes", or otherwise wanting the agent to speak rather than print.
---

# Voice (speak aloud)

Say a short, specific line aloud to the user. Use it when speaking beats printing:
to get the user's attention when they may be away from the screen, to announce that a
long task finished, or to deliver a one-line spoken summary.

This is for **deliberate utterances** — things worth hearing. It is **not** a
text-to-speech reading of the chat. Do not narrate your reasoning or read long output
aloud.

## Engine

The plugin ships `scripts/speak.sh`, which speaks text using macOS **`say`** today.
It is built to swap to **vocli** (a cross-platform TTS engine) later with no change to
how you call it — set `SPEAK_ENGINE=vocli` once vocli's real audio lands (it currently
emits placeholder audio, so `say` is the default).

**macOS-only for now** (the interim `say` engine). On other platforms, fall back to
printing the message until the vocli engine is ready.

## How to speak

Pass the line as an argument or on stdin:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/speak.sh" "Build finished — all tests passed."
# or
echo "Two reviews are waiting on you." | bash "${CLAUDE_PLUGIN_ROOT}/scripts/speak.sh"
```

(`${CLAUDE_PLUGIN_ROOT}` resolves to this plugin's directory; on hosts that don't set
it, use the path to the plugin's `scripts/speak.sh`.)

Optional tuning via environment variables (macOS `say`):

- `SPEAK_VOICE` — a voice name (e.g. `Samantha`).
- `SPEAK_RATE` — words per minute (e.g. `180`).

## What to say

Keep it for the ear — see `references/spoken-medium-principles.md`:

- **Short.** One or two sentences. A spoken line the user takes in at once.
- **Self-contained.** It plays without context on screen; don't reference "the above".
- **No code, URLs, dates, IDs, or paths read aloud.** Summarize them ("the auth
  module", "the linked doc"), don't dictate them.
- **One idea.** If there are two things to say, say the one that matters.

Good: `"Done — the migration ran clean. One test is still flaky; I left a note."`
Avoid: reading a stack trace, a file path, or a URL aloud.

## Future

- **vocli engine.** When vocli ships real TTS, `SPEAK_ENGINE=vocli` routes there for
  better, cross-platform voices — same `speak.sh` call.
- **End-of-turn hook.** A hook runs a *command*, so `speak.sh` could be wired to speak a
  short summary when the agent finishes a turn. Left **off by default** here — an
  always-on spoken summary gets noisy fast. Enable it deliberately if wanted.

## References

- `references/spoken-medium-principles.md` — writing/speaking for the ear.
