# Spoken-Medium Principles

Use this whenever you are shaping content a human will **hear** rather than read —
a podcast, a voice conversation brief, or a spoken line. The listener cannot scan,
re-read, or click. Optimize for low working-memory load and for the ear.

## Write for the ear, not the eye

- **One idea at a time.** Develop a single thought to a useful conclusion before
  moving on. Do not stack several unresolved threads into one breath.
- **Conversational sentences.** Short, plain, spoken-style. Avoid nested clauses a
  listener would lose track of.
- **Progressive disclosure.** Depth is good; overload is not. Reveal detail in
  sequence rather than front-loading every nuance.
- **Short, repeatable labels.** If the listener may need to refer back to an option
  or concept, give it a name they can hold in their head and say back.

## Things that must not be read aloud verbatim

These are fine on a screen and terrible in the ear. Summarize or omit them:

- **Code snippets.** Never ask for code to be read out. Describe what the code does
  in prose ("the handler retries three times, then gives up").
- **URLs.** Refer to "the design doc" or "the linked spec," not the raw link.
- **Long dates / times / version strings.** Say "last spring" or "the current
  release," not "2026-04-03T18:22:00Z" or "v7.58.1".
- **IDs, hashes, file paths.** Say "the migration ticket" or "the auth module," not
  a UUID, a git SHA, or `src/drivers/notebooklm/driver.ts`.
- **Dense enumerations.** Don't recite a ten-item bulleted list. Pick the few that
  matter and speak them as a sentence.

## Decision rule

> If the listener would have to remember more than a few items at once to follow
> along, the content is too dense — narrow it.
