# Conversation modes

Read this to **choose which kind of conversation the liaison should run**, and to learn
what situational brief you need to supply for it. The detailed *conduct* for each mode —
how the liaison opens, behaves, and closes — lives in `../resources/preambles/<mode>.md`
and is written for the **liaison** (the remote agent), **not for you**. You do not need
to read those preambles; you attach the right one to the seed (see SKILL.md, "Assemble
the seed prompt"). Read a preamble only if you want to know exactly how the liaison will
behave.

## How to choose: two questions

1. **Who drives?** Do you (through the liaison) drive a structured agenda, or does the
   human drive while the liaison responds?
2. **Converge or diverge?** Are you narrowing toward a conclusion, or opening up to
   generate ideas or surface what you don't know?

## The modes

### Decision walk-through — `decision`
- **Use when:** one or more decisions must be made and you want a recommendation tested
  and a choice reached. Liaison drives; converges.
- **Brief to supply:** the issue, why it matters now, the two or three options with their
  main trade-offs, your recommendation.
- **You get back:** decisions + reasons + open items.

### Brainstorm — `brainstorm`
- **Use when:** the goal is to generate ideas or explore a space, not to decide. Liaison
  facilitates; diverges, then lightly clusters.
- **Brief to supply:** the space to explore, any constraints, what a good outcome looks
  like.
- **You get back:** ideas raised + the most promising threads.

### Status readout + Q&A — `status-readout`
- **Use when:** you need to brief the human on where things stand and let them
  interrogate it. **The human drives** the questions; the liaison reports and answers
  without pushing an agenda.
- **Brief to supply:** the status itself — what's done, in flight, blocked — and the
  decisions or risks the human may ask about.
- **You get back:** questions asked + answers given + follow-ups.

### Design / architecture review — `design-review`
- **Use when:** a product or architectural design should be examined and stress-tested.
  Liaison drives a structured critique; surfaces risks; converges to findings.
- **Brief to supply:** the design under review, its goals and constraints, and the
  specific questions or risks you want pressure-tested.
- **You get back:** findings + risks + recommendations.

### Discovery / feedback — `discovery`
- **Use when:** gathering input from a customer, stakeholder, or contributor — the goal is
  to *learn*, not to decide. Human-led within the topic; the liaison probes.
- **Brief to supply:** what you're trying to understand, a few areas to probe, who the
  human is.
- **You get back:** what was learned.

## Composing

These are building blocks, not a closed menu. If a real situation straddles two modes — a
review that ends in a decision, a brainstorm that surfaces a blocker — pick the closest
preamble and add a sentence to your brief, or attach two preambles in order. Do not force
a conversation into the wrong mode.
