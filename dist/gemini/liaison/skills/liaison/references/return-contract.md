# Return contract

The conversation closes the loop only if a **structured findings markdown** comes back
to the orchestrating agent. Instruct the remote agent to produce exactly this at the
end of the voice conversation, and arrange a channel to deliver it (see the skill's
"Close the loop" step).

This file defines the **artifact**, not how it travels.

## Shape

```markdown
# Liaison findings: <topic>

## Goal
<the conversation goal — clarify / choose / stress-test / sequence / feedback / discover>

## What we discussed
<a few sentences: the framing, the options or areas covered, how the human reacted>

## Decisions / answers
- <decision or answer 1 — and the reason, briefly>
- <decision or answer 2>
<!-- For feedback/discovery sessions, this is "What we learned" instead. -->

## Open items
- <anything raised but not resolved, with enough context to pick up later>

## Next steps
- <concrete actions the orchestrating agent should take to resume the work>
```

## Rules for the remote agent

- Write it from the **conversation**, not from the seed prompt — capture what the human
  actually said, including where they disagreed with the recommendation.
- Keep decisions and reasons tight. One line each.
- If the human deferred something, it goes under **Open items**, not Decisions.
- Do not invent resolution. If the conversation didn't settle the issue, say so.

## How the orchestrating agent uses it

- Record the decisions/answers and apply them to the blocked work.
- Turn each **Open item** into a follow-up (a task, a TODO, or a later liaison session).
- If **Next steps** conflict with the current plan, reconcile before resuming.
