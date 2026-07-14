---
pack: protobuf
loads_into: [api-design]
verified: "2026-07"
sources:
  - https://protobuf.dev/programming-guides/proto3/
  - https://protobuf.dev/programming-guides/style/
  - https://protobuf.dev/reference/protobuf/google.protobuf/
verify: "Check the repo's actual `syntax = \"proto3\";` (or proto2) declaration before applying proto3-only defaults, and confirm which protoc/buf version is pinned in the build config."
---

# Protocol Buffers

Field numbers are part of the wire format — they, not field order or names, determine binary
compatibility.

## Facts to check against

- **Field-number reuse is never allowed.** A deleted field's number (and name) must be marked
  `reserved`, not reassigned to a new field — old and new clients would otherwise misinterpret
  each other's data. Reserve both the number (`reserved 2;`) and the name (`reserved "old_field";`).
- **Type changes to an existing field break wire compatibility** unless the new type is in the
  documented wire-compatible set (`int32`/`uint32`/`int64`/`uint64`/`bool` interchangeable with each
  other; `sint32`/`sint64` interchangeable with each other; `string`/`bytes` interchangeable if the
  bytes are valid UTF-8). Any other type change requires a new field number, not an in-place edit.
- **proto3 enums must start at `0`**, conventionally named `<ENUM>_UNSPECIFIED`. Enum values
  removed from an existing enum must be `reserved` the same way fields are.
- **proto2 `required` fields are deprecated** — a `required` field can never be safely removed or
  loosened without breaking old clients; use `optional` (proto2) or accept proto3's implicit
  optionality.
- **Well-known types over reinvented ones.** `google.protobuf.Timestamp` instead of an int64
  "seconds since epoch" field with unclear units; `google.protobuf.Duration` instead of a raw
  int64; `google.protobuf.Empty` for a request/response with no fields; the wrapper types
  (`Int32Value`, `StringValue`, ...) when a primitive needs to distinguish "unset" from its zero
  value.
- **Service/RPC changes.** Renaming or deleting an RPC, or changing its request/response type,
  breaks existing clients — add a new RPC and mark the old one `option deprecated = true` instead.
  Changing an RPC from unary to streaming (or the reverse) is the same category of break.
- **`repeated` over manually numbered fields.** `phone1`, `phone2`, `phone3` should be a single
  `repeated string phones = 1;` unless each numbered field carries genuinely distinct semantics
  (like `x`/`y`/`z` coordinates).
- **`package` declaration.** Every `.proto` file should declare a `package` (lowercase,
  dot-separated, including a version segment like `v1`) to avoid polluting a global namespace;
  `option go_package` (or the equivalent for the target language) should be set alongside it.
- **Documentation.** Messages, fields, and RPCs should carry a comment explaining purpose,
  required/optional status, and (for RPCs) the error conditions a caller should expect.
