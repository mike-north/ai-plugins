# Liaison

Liaison lets an agent arrange a live, two-way voice conversation between a human and a briefed AI session, then carry structured findings back into its own workstream. The agent syncs the relevant docs so the remote session is briefed, frames the topic for spoken interaction, and seeds a chat the human continues by voice on their phone — useful when a decision or an ambiguity is faster to talk through than to type, or when the agent needs feedback or discovery from a user, customer, stakeholder, or contributor.

The skill activates when the agent should talk something through with a human: a blocking design decision, a significant ambiguity, or gathering feedback. On Gemini, conversations are seed-only — there is no project file library, so the brief lives entirely in the seed prompt rather than synced docs. Once the human finishes the voice chat, the agent reads the returned findings markdown and resumes work from where it was blocked.
