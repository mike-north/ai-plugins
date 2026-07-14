---
pack: api-design-judgment
loads_into: [api-design]
verified: "2026-07"
sources:
  - https://cloud.google.com/apis/design/design_patterns#list_pagination
  - https://www.ietf.org/archive/id/draft-ietf-httpapi-deprecation-header-06.html
  - https://protobuf.dev/programming-guides/style/#comments
verify: "Check the API's existing sibling endpoints for their established pagination style (cursor vs. offset) before flagging a new endpoint for using the 'other' one — consistency with siblings outranks either style in the abstract."
---

# API design judgment: pagination style, deprecation signaling, proto comments

## Facts to check against

- **Cursor vs. offset pagination — the wrong one for the data.** Offset-based pagination
  (`?offset=0&limit=50`) breaks under concurrent writes: a row inserted before the current offset
  shifts every subsequent page, causing skipped or duplicated results. Cursor-based pagination
  (`?cursor=xyz&limit=50`, returning `nextCursor`) is stable under concurrent mutation but can't
  jump to an arbitrary page number. Flag offset pagination on a frequently-written, unbounded
  collection (activity feeds, logs) — that's where the skip/duplicate bug actually bites; offset
  pagination on a mostly-static or admin-only list is a reasonable tradeoff for the "jump to page
  N" UX it enables.
- **A deprecation with no machine-readable sunset signal.** A `@deprecated` docstring or comment
  tells a human reader but nothing a client can programmatically detect. Pair it with a response
  header consumers can alert on: `Deprecation: true` (or a date) and `Sunset: <HTTP-date>`
  (RFC-style: `Sunset: Sat, 31 Dec 2024 23:59:59 GMT`), optionally with a `Link:
  <...>; rel="deprecation"` pointing at a migration guide. Without it, the deprecation is
  discoverable only by someone reading changelogs — most integrations won't notice until the
  sunset date arrives.
- **Protobuf field comments with no required/optional/deprecated signal.** Proto3 makes every
  field syntactically optional, so the *comment* is the only place "this is actually required in
  practice" is communicated. Comments that just restate the field name (`// The id.` on `string
  id = 1`) carry no information a consumer didn't already have. Prefer a convention with an
  explicit prefix — `// Required: unique identifier.`, `// Optional: display name, defaults to
  email.`, `// Deprecated: use email instead; removed in v3.` — so a reader (or a doc generator)
  can tell required-ness and lifecycle at a glance instead of inferring it from surrounding
  validation code.
