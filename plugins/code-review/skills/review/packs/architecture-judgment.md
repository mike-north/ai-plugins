---
pack: architecture-judgment
loads_into: [architecture]
verified: "2026-07"
sources:
  - https://martinfowler.com/eaaDev/DomainEvent.html
  - https://martinfowler.com/bliki/BoundedContext.html
verify: "Domain events and bounded contexts are judgment calls about a specific business domain — verify against the PR's own domain vocabulary and existing event names in the codebase, not a generic checklist."
---

# Architecture judgment: domain events and bounded context integrity

## Facts to check against

- **A meaningful state transition with no corresponding domain event.** When an aggregate's state
  change matters to other parts of the system (inventory release on cancellation, a notification
  to send, an analytics/reporting update), and that consequence is currently expressed only as a
  side effect buried in the method that changes the state, other consumers have no way to react
  without either polling or the aggregate reaching directly into their concerns. A domain event
  (`OrderCancelled`, emitted alongside the state change) lets consumers subscribe instead of the
  aggregate needing to know about every downstream concern.
- **Domain events named as commands, or leaking implementation detail.** An event should be named
  in the past tense (`OrderPlaced`, not `PlaceOrder` — the latter is a command, describing intent
  before the fact, not a record of what happened) and should carry domain facts, not
  infrastructure details a consumer has no use for: a `UserRegistered` event carrying a
  `PasswordHash` or a database row ID exposes internals no legitimate subscriber needs and creates
  an accidental coupling to storage/security internals. Events should also be immutable once
  created — a mutable event defeats its purpose as a record of something that already happened.
- **One type serving multiple bounded contexts ("god entity").** A single `User` type carrying
  auth fields (`passwordHash`, `lastLoginAt`), billing fields (`billingAddress`,
  `subscriptionTier`), and shipping fields (`shippingAddresses`) forces every context to depend on
  fields it doesn't own and doesn't care about, and a change driven by one context's needs (e.g.
  adding a billing field) risks touching code that has nothing to do with billing. Each bounded
  context should model "the same real-world person" with only the fields that context's business
  rules actually need (`AuthIdentity`, `BillingCustomer`, `ShippingRecipient`), correlated by a
  shared ID rather than sharing one struct.
- **Cross-context references sharing full objects instead of IDs.** When context A holds a live
  reference to context B's full domain object (rather than an ID it can look up through B's own
  API), A becomes coupled to B's internal representation — a refactor inside B that doesn't change
  B's public contract can still break A. This is the same "aggregate references by ID" discipline
  applied across context boundaries, not just within a single aggregate. Watch for whether context
  boundaries in the code align with how the teams/ownership are actually split (Conway's Law) —
  a boundary that cuts across a single team's ownership is a signal it may be modeled wrong for
  this codebase, even if it's textbook-correct in the abstract.
