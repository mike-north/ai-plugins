# The risk template (changeset body) — v1

> **Status**: draft — becomes governing when merged. Owned by judge canon per
> [identity-and-enrollment](./identity-and-enrollment.md) §"The risk template (changeset
> body) — ownership"; the ratification layer owns the header
> ([frontmatter-schema](../ratification/frontmatter-schema.md)) and consumes this body
> opaquely. Governing brief: [the judge](../harness-program/judge.md) §"The judge's
> identity" (structured risk communication).
>
> **Template version**: 1.

The body of a changeset the judge signs. Its job is to make the human's merge decision a
review of *stated risk from a provable author*, not a cold read of a raw config diff — a
trust-router for human attention. The header is the index; this is the judgment.

## Required structure

A changeset body has exactly these sections, in this order. Sections are never omitted; a
section with nothing to say says so explicitly ("no factors beyond the above").

```markdown
## Ruling

<One paragraph: what is being decided, and what it governs. Plain language.>

## Risk: <low-concern | elevated | necessary-evil>

<Why this level and not the adjacent ones. Per risk-vocabulary.md, `elevated` is the
default when unsure — if the argument for a lower level is thin, say so and stay higher.>

## Factors weighed

- <What made this necessary — the triggering observation in context.>
- <What bounds the risk — scope, expiry, pattern narrowness, reversibility.>
- <What was considered and rejected, if anything.>

## Provenance

<The intent article(s) interpreted, and — for any allow-direction rule — the specific,
legible human feedback that authorized it. "No allow-direction content" when tightening.>
```

Loosening proposals (`direction: loosening`) additionally require:

```markdown
## Necessity (loosening only)

- **Why the capability is needed**: <the concrete blocked work.>
- **Narrower alternative rejected**: <what smaller grant was considered, and why it fails.>
- **Blast radius**: <what this grant permits at its widest reading, not its intended use.>
```

## Rules

- **Never bare.** A `riskLevel` in the header is only valid with its argument here
  ([risk-vocabulary](./risk-vocabulary.md)).
- **Written for the human, once.** The body is read by a person deciding whether to merge.
  It never addresses the calling agent and never argues for expedience.
- **Authorship, never endorsement.** The body may state that the judge assesses a change as
  low-risk; it may never state or imply that the judge vouches a loosening is safe. Safety
  vouching for loosening is the human's act ([identity-and-enrollment](./identity-and-enrollment.md)).
- **Sealed with the header.** Header and body are sealed together; any edit to either voids
  the seal. A body edited after signing is a new proposal, not a revision.
- **Versioned.** This template carries a version (above). A changeset body conforms to the
  template version current at propose time; changing the required sections bumps it.

## Worked example — tightening

```markdown
## Ruling

Deny `git remote set-url` invocations that rewrite a GitHub remote from an SSH URL to an
HTTPS URL. Scope: global. Supersedes nothing.

## Risk: low-concern

Denying is the conservative direction and degrades to asking; the pattern is narrow enough
that legitimate remote maintenance (adding a non-GitHub remote, correcting an SSH path) is
untouched. Nothing here can widen capability.

## Factors weighed

- Necessary because the observed attempt routed around the presence-gated SSH credential
  path — the exact desperation shape the governing brief names.
- Risk is bounded: the pattern matches scheme rewrites only, and every miss degrades to the
  normal ask flow rather than a silent block of unrelated git work.
- A broader deny on all `git remote` writes was considered and rejected as over-reaching:
  it would block ordinary repository setup with no added protection for this intent.

## Provenance

Interprets `ssh-always` v1 §§1–2. No allow-direction content.
```

## Worked example — loosening

```markdown
## Ruling

Open `gh pr checks` (read-only) for the `judge-review` agent type, which currently reaches
the human on every invocation. Scope: agent-type. Expiry: none.

## Risk: elevated

Not `low-concern`: this is a loosening, and the surrounding `gh` surface includes commands
that mutate PR state — the grant's correctness depends entirely on the pattern excluding
them. Not `necessary-evil`: the granted command is read-only with no known destructive
form, and the scope is one agent type rather than global.

## Factors weighed

- Necessary because CI-status polling is the single highest-volume ask from this agent
  type, and every one of them has been approved unchanged.
- Risk is bounded by agent-type scope and by the pattern's exclusion of subcommand
  arguments that write.
- A session-scoped grant was considered and rejected: it would re-ask on every new session
  without reducing the blast radius in any meaningful way.

## Necessity (loosening only)

- **Why the capability is needed**: PR monitoring stalls on a human tap for a read that
  reveals nothing the agent cannot already see in the PR page.
- **Narrower alternative rejected**: a forged single-purpose tool wrapping the read — still
  the better long-term shape, but it does not exist yet and this grant is reversible.
- **Blast radius**: at its widest reading, this permits reading check status on any PR in
  any repository the ambient credential can see. It permits no writes.

## Provenance

Interprets `approval-gates-are-load-bearing` v1 §3 (the remedy for a wrong gate is a
proposal, not a workaround). Allow-direction authorization: the approval history for this
exact invocation shape, which a human must confirm as legible reason at merge — this
proposal asserts authorship only.
```

## Non-goals

- No change to the porcelain tool's surface: it keeps consuming the body opaquely via
  `--body-file` ([porcelain-tool](../ratification/porcelain-tool.md)). A
  template-by-reference flag is a later convenience, not a requirement of this spec.
- No opinion on the header's fields, which are the ratification layer's.
