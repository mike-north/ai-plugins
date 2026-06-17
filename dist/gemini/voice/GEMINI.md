# Voice

Voice lets the agent say short lines aloud to you through your computer's speakers — a spoken status, a nudge for attention when you may be away from the screen, or a one-line spoken summary. These are deliberate, specific utterances worth hearing, not a text-to-speech reading of the whole conversation.

It activates when the agent should speak rather than print — for example, when you ask it to "say that out loud," "tell me out loud when it's done," or "announce when the build finishes." Speaking is reserved for the moments where the ear beats the screen; routine output stays printed as usual.

Under the hood it ships `scripts/speak.sh`, which uses the macOS `say` command today and is built to swap to vocli for real cross-platform text-to-speech later. For now it is macOS-only; on other platforms the agent falls back to printing the message.
