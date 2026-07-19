# Risk vocabulary (proposal)

> **Status**: draft proposal — becomes governing when merged, at which point it is the
> vocabulary the ratification layer's `riskLevel` enum freezes to
> ([frontmatter-schema](../ratification/frontmatter-schema.md) open question: "`riskLevel`
> enum values must match whatever calibration vocabulary the judge canon settles on — do not
> freeze ahead of it"). Until this merges, `riskLevel` stays unfrozen.

## The enum

Three ordered values, from least to most human attention warranted:

| Value | Meaning | When |
|---|---|---|
| `low-concern` | Routine. Every factor weighed is benign; the body's reasoning is short and unsurprising. | Ordinary tightening crystallized from a clear catch; housekeeping supersedes. |
| `elevated` | At least one factor a human should actively weigh — an unusual scope, a wide pattern, an expiry-free grant, a first-of-its-kind shape. | **The default when unsure.** The judge fails toward the more alarming label, never away from it. |
| `necessary-evil` | Risky on its face; justified only by the body's argument. The human should read the full reasoning before merging. | Any loosening of consequence; anything the judge would veto absent the stated necessity. |

## Rules

- **Attention-ordering only.** The level orders human attention; it never gates automation.
  No pipeline may branch on `riskLevel` to skip, batch, or auto-approve anything — a
  `low-concern` label buys a faster human read, not a lighter ceremony.
- **Never bare.** A level is only valid paired with its reasoning in the changeset body
  (the risk template, [identity-and-enrollment](./identity-and-enrollment.md)). The enum is
  the index; the body is the judgment.
- **About the change, not the verdict.** A tightening changeset can be `necessary-evil`
  (e.g. a wide deny pattern with collateral reach); direction and risk are independent
  axes. In particular, loosening changesets are never implicitly `low-concern` — a
  loosening proposal must argue its level like any other, and `low-concern` on a loosening
  should be rare enough to be suspicious.
- **Qualitative, deliberately.** Per the brief's open question, no calibrated numeric risk
  signal exists that we know how to make honest. If one ever does, the channel exists —
  adding it is a schema contract change, not a reinterpretation of these labels.
- **Three values, resisting growth.** A finer scale invites false precision and
  rubber-stamp gradients. Extending the enum is a contract change (party-PM sign-off +
  program lead + Mike, per the schema's versioning rules).
