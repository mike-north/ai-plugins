# Intent-document format and lifecycle (draft)

> **Status**: draft — becomes governing when merged. Governing brief:
> [the judge](../harness-program/judge.md) §"Intents, and the ratchet".
>
> Ownership split, load-bearing: **the judge PM owns the format; Mike owns the content.**
> This document is the format. The intent documents themselves (the constitution's articles)
> are Mike's statements of intent, ratified only by his merge — the judge PM drafts them for
> ratification but never decides them.

## What an intent document is

The constitution the judge's rulings cite. Numbered principles like "SSH is always my
credential type when engaging with GitHub." Stating an intent is easy; enumerating every
violating pathway is not — so intents stay short and principled, and the enumeration of
violations accumulates as case law in changesets
([crystallization](./crystallization.md)), each citing the article it interprets.

## Format

One Markdown file per intent-document version, at `docs/judge/intents/intents-v<N>.md`.

- **Document version**: an integer `N`, versioning the document **as a whole**. Any content
  amendment produces v(N+1) as a new file; prior versions are never edited (rulings cite
  them by version — see [lifecycle](#lifecycle)).
- **Header**: title, version, status line ("draft for ratification" until Mike's merge;
  "ratified" thereafter), and ratification date.
- **Principles**: numbered top-level sections, one per intent. Each principle carries:
  - A **stable slug id** (e.g. `ssh-always`) — the value of `intentRef.id`. Slugs are
    permanent: a principle may be amended or retired, but its slug is never reused.
  - A one-sentence **principle statement** — the intent itself, normative.
  - **Numbered clauses** (`1`, `2`, …) — the citable units `intentRef.sections` refers to.
    Clauses may elaborate the principle, name known violating pathways (explicitly
    non-exhaustive — the judge exists because the list can't be written up front), or state
    exclusions.
  - Optionally, a **retired** marker with the version at which retirement was ratified.

## Mapping to the changeset frontmatter

This format is the authoritative source for what the
[frontmatter-schema](../ratification/frontmatter-schema.md)'s `intentRef` fields cite:

| Frontmatter field | Cites |
|---|---|
| `intentRef.id` | a principle's stable slug (e.g. `ssh-always`) |
| `intentRef.version` | the intent-document version interpreted (the integer `N`, serialized as a string) |
| `intentRef.sections` | clause numbers within that principle (as strings, e.g. `["2", "4"]`) |

A citation is **resolvable** iff the named version exists, contains the slug, and contains
each cited clause number. Conformance checking of intents files against this format (and of
citations against intents files) is mechanical and belongs in tooling, not judgment.

## Lifecycle

- **Ratification.** An intent document (or amendment producing a new version) is a canon PR
  ratified **only by Mike's merge** — content is his. The PR carries `decider: mike`
  routing per [D-009](../harness-program/DECISIONS.md).
- **Amendment discipline (trust-drift).** Rulings pin `intentRef.version`. When a new
  version ratifies, the judge line owes the query: *every live ruling citing the prior
  version of any amended principle* — each is re-examined and either re-affirmed against the
  new version (a superseding changeset) or retired. This mirrors the schema's
  `matcherVersion` / `judgeHarnessVersion` discipline: an upstream bump never silently
  re-legitimizes an old interpretation.
- **Retirement.** Retiring a principle is a loosening event (rules derived from it lose
  their constitutional basis) and therefore rides the same Mike-merged ceremony; the slug
  stays reserved.

## Non-goals

- This document does not define any intent's content (Mike's), the changeset header
  (ratification's), or how rulings are matched to commands (steering's matcher, D-011).
