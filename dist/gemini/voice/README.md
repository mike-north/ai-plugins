# Voice

An agent skill for deliberate spoken output. It lets the agent say a short, self-contained line aloud through the computer's speakers — a spoken status, a nudge for attention when you may be away from the screen, or a one-line spoken summary. It is for intentional utterances worth hearing, not a verbatim reading of the chat.

## Requirements

- **macOS** for the interim `say` engine. The bundled `scripts/speak.sh` drives the macOS `say` command; on other platforms it exits with an error until the cross-platform vocli engine is ready.

## Usage

Speak a line by passing it as an argument or on stdin:

```bash
bash scripts/speak.sh "Build finished — all tests passed."
# or
echo "Two reviews are waiting on you." | bash scripts/speak.sh
```

Optional environment variables:

- `SPEAK_ENGINE` — `say` (default) or `vocli`. vocli currently emits placeholder audio, so `say` is the default.
- `SPEAK_VOICE` — macOS `say` voice name (e.g. `Samantha`). *(say engine only)*
- `SPEAK_RATE` — macOS `say` words per minute (e.g. `180`). *(say engine only)*

The `voice` skill auto-activates when the agent should speak aloud rather than print — see `skills/voice/SKILL.md` for when and what to say.

## Status

macOS-only for now, using the interim `say` engine. The wrapper is built to swap to **vocli** for real cross-platform text-to-speech later — set `SPEAK_ENGINE=vocli` once vocli's real audio lands — with no change to how `speak.sh` is called.

An optional end-of-turn hook could wire `speak.sh` to speak a short summary when the agent finishes a turn. It is left **off by default**, since an always-on spoken summary gets noisy fast; enable it deliberately if wanted.

## License

ISC
